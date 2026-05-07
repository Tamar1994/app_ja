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

// Após salvar review, atualizar rating médio do profissional
reviewSchema.post('save', async function () {
  const User = mongoose.model('User');
  const reviews = await mongoose.model('Review').find({ reviewed: this.reviewed });
  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  await User.findByIdAndUpdate(this.reviewed, {
    'professional.rating': Math.round(avg * 10) / 10,
    'professional.totalReviews': reviews.length,
  });
});

module.exports = mongoose.model('Review', reviewSchema);
