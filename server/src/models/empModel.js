
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

  // Set by a transfer when the destination site has no saved attendance yet
  // today. Consumed (and cleared) when that site's draft is built or its
  // attendance is first submitted for the day.
  pendingTransferCheckIn: {
    type: Date,
    default: null
  },

  pendingTransferSiteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    default: null
  },

  // Source site of a pending transfer, carried onto the destination session
  // when the stash is consumed so the "Transferred from <Site>" indicator can
  // be shown in draft mode before attendance is saved.
  pendingTransferFromSiteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    default: null
  },

  pendingTransferDate: {
    type: Date,
    default: null
  },

  // Deferred ("from tomorrow") assignment, written by SiteDetail-context actions
  // (admin) instead of mutating currentSite/currentJob now, and applied by the
  // applyScheduledAssignments cron at the local day rollover. Presence is keyed on
  // scheduledEffectiveDate != null. If scheduledSiteId is set it's a scheduled
  // add/move (apply site + job); if null it's a scheduled job-only change (apply
  // job, leave the current site). See cron/applyScheduledAssignments.js.
  scheduledSiteId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    default: null
  },

  scheduledJobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    default: null
  },

  scheduledEffectiveDate: {
    type: Date,
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
  },

  // Worker category, denormalized from the employee's JobTitle. 'skilled' =
  // blue-collar field worker; 'staff' = white-collar office worker. Staff are
  // excluded from site man-hours/man-days stats but still tracked and paid.
  // Kept in sync in addEmployee/editEmployee and on job-title reclassification.
  collarType: {
    type: String,
    enum: ['skilled', 'staff'],
    default: 'skilled'
  },

  // Nationality, orthogonal to collarType. Together they form the four roster
  // categories: (skilled|staff) × (foreign|omani) → Foreign Skilled Labours,
  // Foreign Staffs, Omani Labours, Omani Staffs. Each category has its own site
  // default check-in/out. Unlike collarType (derived from the job title), this is
  // set on the employee.
  nationality: {
    type: String,
    enum: ['foreign', 'omani'],
    default: 'foreign'
  }

}, {
  timestamps: true
});

employeeSchema.index({ currentJob: 1 });

employeeSchema.index({ currentSite: 1 });

export default mongoose.model('Employee', employeeSchema);