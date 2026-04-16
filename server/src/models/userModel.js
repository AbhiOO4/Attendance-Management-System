import mongoose from "mongoose"

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
    minlength: 8,
    select: false // Prevents password from being returned in queries by default
  },
  role: {
    type: String,
    enum: ['admin', 'Supervisor'],
    default: 'Supervisor'
  },
  assignedSite: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site', 
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
});

export default mongoose.model('User', userSchema);
