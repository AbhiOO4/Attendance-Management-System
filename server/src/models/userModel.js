import mongoose from "mongoose"
import bcrypt from "bcryptjs"

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true
  },

  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    trim: true
  },

  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
    select: false
  },

  role: {
    type: String,
    enum: ['admin', 'supervisor', 'superadmin'],
    default: 'supervisor'
  },

  assignedSite: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    default: null
  },

  employeeId: {
    type: String,
    ref: 'Employee',
    required: function () {
      return this.role === "supervisor";
    },

    unique: true,
    sparse: true,
  },

  // Web-Push subscriptions for this user's installed PWA instances. An array
  // (not a single object) because a supervisor may install the PWA on several
  // devices (phone + desktop); each is deduped by `endpoint`. Dead endpoints
  // (404/410 on send) are pruned by utils/webPush.js.
  pushSubscriptions: [{
    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String },
      auth: { type: String },
    },
    userAgent: { type: String },
    createdAt: { type: Date, default: Date.now },
  }],

  // Per-day throttle state for the unclosed-session ("check-out") reminder cron
  // (cron/checkoutReminder.js). `date` is the local YYYY-MM-DD the counter
  // applies to; it resets when a new day starts so reminders are capped per day.
  checkoutReminder: {
    date: { type: String, default: null },
    count: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
  },

}, {
  timestamps: true
});


userSchema.pre("save", async function() {
  if (!this.isModified("password")) return

  this.password = await bcrypt.hash(this.password, 10)
})




userSchema.index({ assignedSite: 1 });

export default mongoose.model('User', userSchema);