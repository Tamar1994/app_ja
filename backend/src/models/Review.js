const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    required: true,
  },
  reviewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  reviewed: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  reviewerRole: {
    type: String,
    enum: ['client', 'professional'],
    required: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  comment: {
    type: String,
    default: '',
    maxlength: 500,
  },
}, { timestamps: true });

// Atualiza rating médio do profissional SOMENTE quando um cliente avalia
reviewSchema.post('save', async function () {
  if (this.reviewerRole !== 'client') return;
  const User = mongoose.model('User');
  const reviews = await mongoose.model('Review').find({ reviewed: this.reviewed, reviewerRole: 'client' });
  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  await User.findByIdAndUpdate(this.reviewed, {
    'professional.rating': Math.round(avg * 10) / 10,
    'professional.totalReviews': reviews.length,
  });
});

module.exports = mongoose.model('Review', reviewSchema);
