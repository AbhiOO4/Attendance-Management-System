
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
    required: [true, 'Monthly salary is required']
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

  isActive: {
    type: Boolean,
    default: true
  }

}, {
  timestamps: true
});


employeeSchema.index({ currentSite: 1 });

export default mongoose.model('Employee', employeeSchema);