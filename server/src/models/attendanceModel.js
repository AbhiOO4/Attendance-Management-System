import mongoose from "mongoose"


const attendanceSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: [true, 'Attendance must belong to an employee']
  },
  siteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site', // Assumes your site model is named 'Site'
    required: [true, 'Site ID is required']
  },
  markedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'The supervisor/admin marking attendance must be recorded']
  },
  date: {
    type: Date, 
    required: [true, 'Date is required'],
  },
  status: {
    type: String,
    enum: {
      values: ['Present', 'absent', 'halfday'],
      message: '{VALUE} is not a valid status'
    },
    required: true
  },
  remarks: {
    type: String,
    trim: true
  }
}, { 
  timestamps: true 
});

// This index ensures an employee can't have two attendance records for the same day
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

export default mongoose.model('Attendance', attendanceSchema);

