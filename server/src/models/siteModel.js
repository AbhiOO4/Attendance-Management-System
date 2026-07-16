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
  // Hour (0-12) when this site's "logical business day" ends: times before it belong to
  // the previous day. MACHINE-MANAGED — derived from the site's default shift times
  // (utils/siteCutoff.js), never user-set. Mirrors the currently-active cutoffHistory
  // entry; read it through getCurrentCutoff()/resolveCutoffForDate() (utils/cutoff.js),
  // never directly: a record must be interpreted with the cutoff in force on ITS OWN
  // business day.
  nightShiftCutoffHour: {
    type: Number,
    min: 0,
    max: 12,
    // 0 = midnight: no night shifts / plain calendar days (the derived value for a site
    // with no night default check-out). createSite sets this explicitly at creation.
    default: 0
  },
  // Effective-dated history of this site's derived cutoff, ascending by effectiveFrom.
  // Seeded from the global WorkSchedule history (which governed all sites before cutoffs
  // became per-site); re-derived automatically whenever the default times change, with the
  // new value effective from tomorrow's business day so already-written records keep the
  // cutoff their stored check-in/out Dates were combined with.
  cutoffHistory: {
    type: [
      {
        cutoffHour: {
          type: Number,
          required: true,
          min: 0,
          max: 12
        },
        // UTC-midnight of the first business day this cutoff applies to.
        effectiveFrom: {
          type: Date,
          required: true
        },
        _id: false
      }
    ],
    default: []
  }
}, {
  timestamps: true
});

export default mongoose.model('Site', siteSchema);

