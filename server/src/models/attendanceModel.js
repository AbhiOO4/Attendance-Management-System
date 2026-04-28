import mongoose from "mongoose"

const attendanceSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: [true, 'Attendance must belong to an employee']
  },
  siteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
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
      values: ['present', 'absent', 'halfday'],
      message: '{VALUE} is not a valid status'
    },
    required: true
  },

  // NEW: marks if the day is a holiday
  isHoliday: {
    type: Boolean,
    default: false
  },

  // NEW: actual working hours for the day
  workHours: {
    type: Number,
    default: 0
  },

  // RENAMED: clearer meaning
  overtimeHours: {
    type: Number,
    default: 0
  }

}, { 
  timestamps: true 
});

// Prevent duplicate attendance per employee per day
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

// Optional: useful for site/day queries
attendanceSchema.index({ siteId: 1, date: 1 });

export default mongoose.model('Attendance', attendanceSchema);