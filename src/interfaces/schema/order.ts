import mongoose from 'mongoose';

interface ItemOrder {
  name: string;
  quantity: number;
  price: number;
  image: string;
}

export interface OrderSchema {
  items: ItemOrder[];
  totalPrice: number;
  tax: number;
  shippingFee: number;
  customerInfo: {
    name: string;
    email: string;
    phone: string;
  };
  receiverInfo: {
    name: string;
    email: string;
    phone: string;
  };
  shippingAddress: {
    city: string;
    country: string;
    line1: string;
    line2: string;
    postal_code: string;
    state: string;
  };
  paymentMethod: string;
  isPaid: boolean;
  canceledBy: string;
  description: string;
  orderStatus: string;
}
