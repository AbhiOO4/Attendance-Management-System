import mongoose from "mongoose"

/**
 * A lightweight in-app notification. There was no in-app feed before the
 * transfer-request feature (delivery was push-only); this backs the Requests
 * page "Activity" list and the sidebar unread badge, alongside best-effort web
 * push (see utils/notify.js). Rows are per-user and disposable — read/prune as
 * needed; nothing else depends on them.
 */
const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "request_received", // an incoming transfer request needs your decision
        "request_accepted", // your request was accepted (employee arrives)
        "request_rejected", // your request was rejected
        "transfer_arrived", // a midday transfer landed an employee at your site
        "transfer_departed", // an employee was moved off your site (or their shift here was cut short) by someone else
        "request_expired", // your pending request was overtaken (employee placed directly, site closed, day ended)
        "request_escalated", // legacy: the stale-request escalation cron (removed; admins now see every request)
      ],
      required: true,
    },

    title: {
      type: String,
      required: true,
    },

    body: {
      type: String,
      default: "",
    },

    // Deep-link consumed by the SW push handler / clicked in the Activity feed.
    url: {
      type: String,
      default: "/requests",
    },

    relatedRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TransferRequest",
      default: null,
    },

    read: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
)

// Unread badge count + reverse-chronological feed for one user.
notificationSchema.index({ user: 1, read: 1, createdAt: -1 })

export default mongoose.model("Notification", notificationSchema)
