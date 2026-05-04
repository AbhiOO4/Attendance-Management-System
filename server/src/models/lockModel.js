import mongoose from "mongoose"

const attendanceLockSchema = new mongoose.Schema({
  siteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  isLocked: {
    type: Boolean,
    default: true // after submit → locked
  },
  lockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lockedAt: {
    type: Date
  },
  unlockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  unlockedAt: {
    type: Date
  }
}, {
  timestamps: true
})


attendanceLockSchema.index({ siteId: 1, date: 1 }, { unique: true })

export default mongoose.model('AttendanceLock', attendanceLockSchema)