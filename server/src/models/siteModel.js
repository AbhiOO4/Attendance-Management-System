import mongoose from "mongoose";

const siteSchema = new mongoose.Schema({
  siteName: {
    type: String,
    required: [true, 'Site name is required'],
    unique: true,
    trim: true,
    index: true
  },
  locationDetails: {
    type: String,
    trim: true,
    default: "" // Optional field
  },
  jobs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job'
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isPermanent: {
    type: Boolean,
    default: false
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  isCompleted: {
    type: Boolean,
    default: false
  },
  defaultCheckIn: {
    type: String,
    trim: true,
    default: ""
  },
  defaultCheckOut: {
    type: String,
    trim: true,
    default: ""
  },
  nightDefaultCheckIn: {
    type: String,
    trim: true,
    default: ""
  },
  nightDefaultCheckOut: {
    type: String,
    trim: true,
    default: ""
  }
}, {
  timestamps: true
});

export default mongoose.model('Site', siteSchema);

