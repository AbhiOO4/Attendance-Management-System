import mongoose from "mongoose";

const siteSchema = new mongoose.Schema({
  siteName: {
    type: String,
    required: [true, 'Site name is required'],
    unique: true,
    trim: true
  },
  locationDetails: {
    type: String,
    trim: true,
    default: "" // Optional field
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

export default mongoose.model('Site', siteSchema);

