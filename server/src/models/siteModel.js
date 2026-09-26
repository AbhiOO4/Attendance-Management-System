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
  },
  // Fixed default check-in/out for staff (white-collar) workers, separate from
  // the field-worker day/night defaults above. Day + night pairs.
  staffDefaultCheckIn: {
    type: String,
    trim: true,
    default: ""
  },
  staffDefaultCheckOut: {
    type: String,
    trim: true,
    default: ""
  },
  staffNightDefaultCheckIn: {
    type: String,
    trim: true,
    default: ""
  },
  staffNightDefaultCheckOut: {
    type: String,
    trim: true,
    default: ""
  },
  // Omani-worker defaults, separate from the (foreign) skilled/staff defaults above.
  // omani*  → Omani Labours (skilled + omani); omaniStaff* → Omani Staffs (staff + omani).
  // Day + night pairs, mirroring the foreign categories. The four categories are
  // (skilled|staff) × (foreign|omani); nationality is a per-employee attribute.
  omaniDefaultCheckIn: {
    type: String,
    trim: true,
    default: ""
  },
  omaniDefaultCheckOut: {
    type: String,
    trim: true,
    default: ""
  },
  omaniNightDefaultCheckIn: {
    type: String,
    trim: true,
    default: ""
  },
  omaniNightDefaultCheckOut: {
    type: String,
    trim: true,
    default: ""
  },
  omaniStaffDefaultCheckIn: {
    type: String,
    trim: true,
    default: ""
  },
  omaniStaffDefaultCheckOut: {
    type: String,
    trim: true,
    default: ""
  },
  omaniStaffNightDefaultCheckIn: {
    type: String,
    trim: true,
    default: ""
  },
  omaniStaffNightDefaultCheckOut: {
    type: String,
    trim: true,
    default: ""
  },
  // Bumped inside every transaction that submits this site's day or moves an employee onto /
  // off its roster (utils/draftRoster.js touchSiteRosters). Its value means nothing — the
  // shared WRITE is what makes a submit and a concurrent roster move conflict, so one aborts
  // instead of both committing against each other's stale roster.
  rosterRev: {
    type: Number,
    default: 0
  },
  // NOTE: nightShiftCutoffHour / cutoffHistory were removed with the cutoff redesign.
  // A site's day and night default windows may now overlap freely; cross-midnight is an
  // explicit per-session day offset on the attendance record, not a derived boundary hour.
}, {
  timestamps: true
});

export default mongoose.model('Site', siteSchema);

