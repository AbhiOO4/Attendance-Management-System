import mongoose from "mongoose"


const jobSchema = new mongoose.Schema({
  name: String,

  jobCode: {
    type: String,
    unique: true,
  },

  site: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Site",
    required: true
  },

  employees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
  }],

  isActive: {
    type: Boolean,
    default: true,
  }
}, { timestamps: true })

export default mongoose.model('Job', jobSchema)

