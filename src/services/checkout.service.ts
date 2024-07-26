import config from '@/config/env.config';
import { BadRequestError } from '@/error/customError';
import Order from '@/models/Order';
import { NextFunction, Request, Response } from 'express';
import Stripe from 'stripe';
import { buildSigned, createVpnUrl } from '@/utils/vnpayGenerator';
import { ORDER_STATUS, PAYMENT_METHOD } from '@/constant/order';
import generateOrderStatusLog from '@/utils/generateOrderStatusLog';
import User from '@/models/User';

const stripe = new Stripe(config.stripeConfig.secretKey);

// create a new checkout
export const createCheckoutStripe = async (req: Request, res: Response, next: NextFunction) => {
    const lineItems = req.body.items.map((item: any) => ({
        price_data: {
            currency: req.body.currency ?? 'usd',
            product_data: {
                name: item.name,
                images: [item.image],
            },
            unit_amount: item.price,
        },
        quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        metadata: { userId: req.userId.toString() },
        phone_number_collection: {
            enabled: true,
        },
        invoice_creation: {
            enabled: true,
        },
        shipping_address_collection: {
            allowed_countries: ['VN', 'US'],
        },
        billing_address_collection: 'required',
        mode: 'payment',
        success_url: config.stripeConfig.urlSuccess,
        cancel_url: config.stripeConfig.urlCancel,
    });

    return res.status(200).json({ sessionId: session.id, sessionUrl: session.url });
};

const createOrder = async (session: Stripe.Checkout.Session) => {
    try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

        // Initialize an array to hold line items with product details
        const detailedLineItems = [];
        // Fetch detailed product information for each line item
        for (const item of lineItems.data) {
            if (item.price && item.price.product) {
                const product = await stripe.products.retrieve(item.price.product as string);
                detailedLineItems.push({
                    ...item,
                    image: product.images[0],
                    name: product.name,
                });
            }
        }

        const dataItems = detailedLineItems.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            price: item.amount_total,
            image: item.image,
        }));

        // Create a new order
        if (session) {
            const userId = session.metadata && session.metadata?.userId;
            const userData = await User.findOne({ _id: userId });
            const newOrder = new Order({
                userId: session.metadata && session.metadata?.userId, // Assuming you have userId in metadata
                items: dataItems,
                totalPrice: session.amount_total,
                paymentMethod: session.payment_method_types[0],
                shippingAddress: session.customer_details?.address,
                customerInfo: {
                    name: userData?.username,
                    email: userData?.email,
                    phone: userData?.phone ? userData?.phone : '',
                },
                receiverInfo: {
                    name: session.customer_details?.name,
                    email: session.customer_details?.email,
                    phone: session.customer_details?.phone,
                },
                isPaid: session.payment_status === 'paid',
            });
            console.log('Order saved successfully');
        }
    } catch (error) {
        console.error('Error processing checkout.session.completed event:', error);
    }
};

export const handleSessionEventsStripe = async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;

    const sig: any = req.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(payload, sig, config.stripeConfig.endpointSecret);
    } catch (err: any) {
        throw new BadRequestError(`Webhook: ${err.message}`);
    }

    console.log('event type:', event.type);

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object as Stripe.Checkout.Session;

            await createOrder(session);
            break;
        }

        case 'checkout.session.async_payment_succeeded': {
            const session = event.data.object;

            break;
        }

        case 'checkout.session.async_payment_failed': {
            const session = event.data.object;

            break;
        }

        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    return res.status(200).json({ received: true });
};

export const createPaymentUrlWithVNpay = async (req: Request, res: Response, next: NextFunction) => {
    const ipAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const bankCode = '';
    const locale = 'en';
    const totalPrice = req.body.totalPrice;
    const paymentMethod = PAYMENT_METHOD.CARD;
    const datacache = { ...req.body, paymentMethod, totalPrice: totalPrice / 25 };
    const order = await Order.create(datacache);

    const vnpUrl = createVpnUrl({
        ipAddr,
        bankCode,
        locale,
        amount: totalPrice,
        vnPayReturnUrl: config.vnpayConfig.vnp_ReturnUrl,
        orderId: order._id.toString(),
    });
    res.status(200).json({ checkout: vnpUrl });
};

export const vnpayReturn = async (req: Request, res: Response, next: NextFunction) => {
    const vnp_Params = req.query;
    console.log(vnp_Params);
    const secureHash = vnp_Params['vnp_SecureHash'];
    const signed = buildSigned(vnp_Params);

    if (secureHash === signed) {
        const data = await Order.findByIdAndUpdate(vnp_Params['vnp_TxnRef'], {
            isPaid: true,
            currentOrderStatus: ORDER_STATUS.CONFIRMED,
            paymentMethod: PAYMENT_METHOD.CARD,
            orderStatusLogs: generateOrderStatusLog({
                statusChangedBy: req.userId,
                orderStatus: ORDER_STATUS.CONFIRMED,
                reason: 'User paid by VNPay',
            }),
        });
        res.status(200).json({ code: vnp_Params['vnp_ResponseCode'], message: 'Success', data });
    } else {
        res.status(400).json({ code: '97' });
    }
};

export const vnpayIpn = async (req: Request, res: Response, next: NextFunction) => {
    const vnp_Params = req.query;
    const secureHash = vnp_Params['vnp_SecureHash'];
    const rspCode = vnp_Params['vnp_ResponseCode'];

    const signed = buildSigned(vnp_Params);
    const paymentStatus = '0';

    const checkOrderId = true;
    const checkAmount = true;
    if (secureHash === signed) {
        if (checkOrderId) {
            if (checkAmount) {
                if (paymentStatus == '0') {
                    if (rspCode == '00') {
                        await Order.findByIdAndUpdate(vnp_Params['vnp_TxnRef'], {
                            isPaid: true,
                            currentOrderStatus: ORDER_STATUS.CONFIRMED,
                            paymentMethod: PAYMENT_METHOD.CARD,

                            OrderStatusLogs: generateOrderStatusLog({
                                statusChangedBy: req.userId,
                                orderStatus: ORDER_STATUS.CONFIRMED,
                                reason: 'User paid by VNPay',
                            }),
                        });

                        res.status(200).json({ code: '00', message: 'Success' });
                    } else {
                        await Order.findByIdAndUpdate(vnp_Params['vnp_TxnRef'], {
                            isPaid: true,
                            orderStatus: ORDER_STATUS.CONFIRMED,
                        });
                        res.status(200).json({ code: rspCode, message: 'Fail' });
                    }
                } else {
                    res.status(200).json({
                        code: '02',
                        message: 'This order has been updated to the payment status',
                    });
                }
            } else {
                res.status(200).json({ code: '04', message: 'Amount invalid' });
            }
        } else {
            res.status(200).json({ code: '01', message: 'Order not found' });
        }
    } else {
        res.status(200).json({ code: '97', message: 'Checksum failed' });
    }
};
