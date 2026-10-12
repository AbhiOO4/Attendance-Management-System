import mongoose from "mongoose"


const jobSchema = new mongoose.Schema({
  name: String,

  jobCode: {
    type: String,
    unique: true,
  },

  // A site job belongs to one site. A GLOBAL job (utils/globalJobs.js) has no site: it is
  // offered on every site's attendance sheet and the drivers sheet as a SESSION job only
  // (general-expense hours) — never an employee's currentJob / roster job, never a
  // placement destination.
  site: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Site",
    required: function () {
      return !this.isGlobal
    },
    default: null,
  },

  isGlobal: {
    type: Boolean,
    default: false,
    index: true,
  },

  employees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
  }],

  isActive: {
    type: Boolean,
    default: true,
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  isCompleted: {
    type: Boolean,
    default: false
  }
}, { timestamps: true })

export default mongoose.model('Job', jobSchema)

