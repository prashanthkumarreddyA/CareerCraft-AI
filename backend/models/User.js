import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      unique: true, // creates a unique index
    },
    passwordHash: { type: String, required: true, select: false },
    // Incremented on logout; tokens carrying an older version are rejected (revokes all sessions).
    tokenVersion: { type: Number, default: 0, select: false },
  },
  { timestamps: true, versionKey: false },
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => ({ id: String(ret._id), name: ret.name, email: ret.email, createdAt: ret.createdAt }),
});

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
