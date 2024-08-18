import { AttributeType } from '@/constant/attributeType';
import { IAttributeSchema } from '@/interfaces/schema/attribute';
import mongoose from 'mongoose';

const attributeSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            unique: true,
            require: true,
        },
        attributeKey: {
            type: String,
            unique: true,
        },
        isVariant: { type: Boolean, default: false },
        isRequired: { type: Boolean, default: false },
        type: { type: String, enum: Object.values(AttributeType), default: AttributeType.Manual },
        values: [
            {
                type: String || Number,
                default: [],
            },
        ],
    },
    { versionKey: false, timestamps: true },
);

attributeSchema.pre('save', async function (next) {
    this.attributeKey = this.name!.toLowerCase().replace(/ /g, '_');
    next();
});
const Attribute = mongoose.model<IAttributeSchema>('Attribute', attributeSchema);

export default Attribute;
