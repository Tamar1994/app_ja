const mongoose = require('mongoose');

// Uma fase define a taxa que se aplica a partir de um certo ponto no tempo.
// Para imediato: minutesAfterAccepted = minutos decorridos desde o aceite
// Para agendado: hoursBeforeScheduled = horas restantes até o início

const immediatePhaseSchema = new mongoose.Schema({
  label:                  { type: String, required: true, trim: true },
  minutesAfterAccepted:   { type: Number, required: true, min: 0, default: 0 },
  platformFeePercent:     { type: Number, required: true, min: 0, max: 100, default: 0 },
  professionalFeePercent: { type: Number, required: true, min: 0, max: 100, default: 0 },
  sortOrder:              { type: Number, default: 0 },
}, { _id: false });

const scheduledPhaseSchema = new mongoose.Schema({
  label:                  { type: String, required: true, trim: true },
  hoursBeforeScheduled:   { type: Number, required: true, min: 0, default: 0 },
  platformFeePercent:     { type: Number, required: true, min: 0, max: 100, default: 0 },
  professionalFeePercent: { type: Number, required: true, min: 0, max: 100, default: 0 },
  sortOrder:              { type: Number, default: 0 },
}, { _id: false });

const cancellationConfigSchema = new mongoose.Schema({
  // null = aplica para qualquer cidade / qualquer tipo de serviço
  coverageCityId:  { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCoverageCity', default: null, index: true },
  serviceTypeSlug: { type: String, default: null, trim: true, lowercase: true },

  // Descrição interna (visível apenas no admin)
  label: { type: String, default: '', trim: true },

  status: { type: String, enum: ['active', 'inactive'], default: 'active' },

  // Fases para pedidos imediatos (trigger: minutos desde o aceite)
  // Fase com maior minutesAfterAccepted <= tempo decorrido é aplicada
  immediatePhases: { type: [immediatePhaseSchema], default: [] },

  // Fases para pedidos agendados (trigger: horas restantes até o início)
  // Fase com maior hoursBeforeScheduled <= horas restantes é aplicada
  scheduledPhases: { type: [scheduledPhaseSchema], default: [] },
}, { timestamps: true });

// Index de busca (cidade + tipo de serviço)
cancellationConfigSchema.index({ coverageCityId: 1, serviceTypeSlug: 1 });

module.exports = mongoose.model('CancellationConfig', cancellationConfigSchema);
