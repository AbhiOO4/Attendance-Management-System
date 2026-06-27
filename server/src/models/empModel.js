
import mongoose from "mongoose"

const employeeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Employee name is required'],
    trim: true
  },

  employeeId: {
    type: String,
    required: [true, 'Employee ID is required'],
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },

  jobTitle: {
    type: String,
    required: [true, 'Job title is required'],
    trim: true,
    lowercase: true
  },

  monthlySalary: {
    type: Number,
    default: 0
  },

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', //ref to supervisor id
    default: null
  },

  currentSite: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    default: null
  },

  currentJob: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    default: null
  },

  isActive: {
    type: Boolean,
    default: true
  },

  employmentType: {
    type: String,
    enum: ['permanent', 'temporary'],
    default: 'permanent'
  }

}, {
  timestamps: true
});

employeeSchema.index({ currentJob: 1 });

employeeSchema.index({ currentSite: 1 });

export default mongoose.model('Employee', employeeSchema);