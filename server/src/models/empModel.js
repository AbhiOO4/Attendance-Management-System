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
  isSupervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  currentSite: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site', 
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true // Automatically creates 'createdAt' and 'updatedAt' fields
});

export default mongoose.model('Employee', employeeSchema);

