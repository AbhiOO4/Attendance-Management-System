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
    enum: ['admin', 'supervisor'],
    default: 'supervisor'
  },

  assignedSite: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    default: null
  }

}, {
  timestamps: true
});


userSchema.pre("save", async function() {
  if (!this.isModified("password")) return

  this.password = await bcrypt.hash(this.password, 10)
})




userSchema.index({ assignedSite: 1 });

export default mongoose.model('User', userSchema);