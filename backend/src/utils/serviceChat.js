const ServiceChat = require('../models/ServiceChat');

async function ensureServiceChatForRequest(serviceRequest) {
  if (!serviceRequest?.professional || !serviceRequest?.clientConfirmedAt) return null;

  try {
    const chat = await ServiceChat.create({
      requestId: serviceRequest._id,
      clientId: serviceRequest.client,
      professionalId: serviceRequest.professional,
      status: 'active',
    });
    return chat;
  } catch (error) {
    if (error.code === 11000) {
      return ServiceChat.findOne({ requestId: serviceRequest._id });
    }
    throw error;
  }
}

async function closeServiceChatForRequest(requestId, reason = null) {
  return ServiceChat.findOneAndUpdate(
    { requestId, status: 'active' },
    {
      status: 'closed',
      closedAt: new Date(),
      closedReason: reason || null,
    },
    { new: true }
  );
}

module.exports = {
  ensureServiceChatForRequest,
  closeServiceChatForRequest,
};
