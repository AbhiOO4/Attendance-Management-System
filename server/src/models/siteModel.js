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
  // 24-hour shift: a continuous shift (e.g. security/watchmen) that runs from a single
  // start time to the SAME time the next day (07:00 → 07:00 +1 = 24h). Scoped to the
  // FOREIGN SKILLED LABOURS category only — when on, their check-in is prefilled at
  // `shift24StartTime` and the auto check-out cron closes the open session at that time
  // the next day with an EXPLICIT next-day flag (the one case the wall clock can't infer,
  // since check-out reads equal to check-in). The site's other three categories keep
  // their normal day/night defaults.
  is24HourShift: {
    type: Boolean,
    default: false
  },
  shift24StartTime: {
    type: String,
    trim: true,
    default: ""
  },
  // NOTE: nightShiftCutoffHour / cutoffHistory were removed with the cutoff redesign.
  // A site's day and night default windows may now overlap freely; cross-midnight is an
  // explicit per-session day offset on the attendance record, not a derived boundary hour.
}, {
  timestamps: true
});

export default mongoose.model('Site', siteSchema);

