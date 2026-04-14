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

const Site = mongoose.model('Site', siteSchema);

module.exports = Site;