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
    unique: true, // Ensures no two employees share the same ID
    uppercase: true,
    trim: true
  },
  jobTitle: {
    type: String,
    required: [true, 'Job title is required'],
    trim: true
  },
  currentSite: {
    type: String,
    default: ""
  },
  status: {
    type: String,
    enum: {
      values: ['active', 'inactive'],
      message: '{VALUE} is not a valid status'
    },
    default: 'active'
  }
}, {
  timestamps: true // Automatically creates 'createdAt' and 'updatedAt' fields
});

const Employee = mongoose.model('Employee', employeeSchema);

module.exports = Employee;