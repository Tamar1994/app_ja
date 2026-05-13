/**
 * ProfessionalUpgradeScreen
 * Tela para clientes que querem ativar o perfil profissional.
 * O cliente já tem selfie/doc da verificação de cliente.
 * Aqui ele envia apenas o comprovante de residência (+ docs solicitados em reenvio).
 * Após envio, volta para o perfil de cliente — o switch profissional fica como "aguardando".
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Image, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../context/AuthContext';
import { uploadProfessionalUpgrade, userAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius } from '../../theme';

export default function ProfessionalUpgradeScreen({ navigation }) {
  const { user, setUser } = useAuth();
  const [residenceProof, setResidenceProof] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [document, setDocument] = useState(null);
  const [documentBack, setDocumentBack] = useState(null);
  const [loading, setLoading] = useState(false);

  // Docs solicitados em reenvio parcial
  const pvStatus = user?.professionalVerification?.status;
  const isResubmit = pvStatus === 'resubmit_requested';
  const requiredDocs = isResubmit
    ? (user?.professionalVerification?.resubmitRequest?.requiredDocuments || [])
    : ['residenceProof'];
  const resubmitMessage = user?.professionalVerification?.resubmitRequest?.message || '';

  const setters = {
    selfie: setSelfie,
    document: setDocument,
    documentBack: setDocumentBack,
    residenceProof: setResidenceProof,
  };

  const showImageOptions = (type) => {
    Alert.alert('Adicionar foto', 'Como deseja adicionar?', [
      { text: 'Câmera', onPress: () => takePhoto(type) },
      { text: 'Galeria', onPress: () => pickImage(type) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const pickImage = async (type) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permissão necessária', 'Precisamos de acesso às suas fotos.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: type === 'selfie',
      aspect: type === 'selfie' ? [1, 1] : [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setters[type](result.assets[0]);
  };

  const takePhoto = async (type) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permissão necessária', 'Precisamos de acesso à câmera.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: type === 'selfie',
      aspect: type === 'selfie' ? [1, 1] : [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setters[type](result.assets[0]);
  };

  const handleUpload = async () => {
    // Validar que todos os docs solicitados foram preenchidos
    const stateMap = { selfie, document, documentBack, residenceProof };
    const missing = requiredDocs.filter((doc) => !stateMap[doc]);
    if (missing.length > 0) {
      const labels = { selfie: 'Selfie', document: 'Doc. Frente', documentBack: 'Doc. Verso', residenceProof: 'Comprovante de Residência' };
      Alert.alert('Atenção', `Envie: ${missing.map((d) => labels[d] || d).join(', ')}`);
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      if (selfie) formData.append('selfie', { uri: selfie.uri, type: 'image/jpeg', name: 'selfie.jpg' });
      if (document) formData.append('document', { uri: document.uri, type: 'image/jpeg', name: 'document.jpg' });
      if (documentBack) formData.append('documentBack', { uri: documentBack.uri, type: 'image/jpeg', name: 'documentBack.jpg' });
      if (residenceProof) {
        const isImage = residenceProof.mimeType ? residenceProof.mimeType.startsWith('image/') : !residenceProof.uri.endsWith('.pdf');
        formData.append('residenceProof', {
          uri: residenceProof.uri,
          type: isImage ? 'image/jpeg' : 'application/pdf',
          name: isImage ? 'residencia.jpg' : 'residencia.pdf',
        });
      }

      const res = await uploadProfessionalUpgrade(formData);
      if (setUser && res?.user) {
        setUser((prev) => ({ ...prev, ...res.user }));
      } else {
        const { data } = await userAPI.getMe();
        setUser(data.user);
      }

      Alert.alert(
        '✅ Documentos enviados!',
        'Seus documentos foram encaminhados para análise. Em até 24 horas você receberá uma resposta. Enquanto isso, continue usando o perfil de cliente normalmente.',
        [{ text: 'OK', onPress: () => navigation?.goBack() }]
      );
    } catch (err) {
      Alert.alert('Erro', err?.response?.data?.message || 'Erro ao enviar documentos. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const PhotoCard = ({ type, image, label, hint, icon }) => (
    <View style={styles.photoCard}>
      <Text style={styles.photoLabel}>{label}</Text>
      <Text style={styles.photoHint}>{hint}</Text>
      <TouchableOpacity
        style={[styles.photoBox, image && styles.photoBoxFilled]}
        onPress={() => showImageOptions(type)}
        activeOpacity={0.8}
      >
        {image ? (
          <>
            <Image source={{ uri: image.uri }} style={styles.photoPreview} />
            <View style={styles.changeOverlay}>
              <Ionicons name="camera" size={20} color="#fff" />
              <Text style={styles.changeText}>Alterar</Text>
            </View>
          </>
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name={icon} size={40} color={colors.primary} />
            <Text style={styles.photoPlaceholderText}>Toque para adicionar</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );

  const allDone = requiredDocs.every((doc) => {
    if (doc === 'selfie') return !!selfie;
    if (doc === 'document') return !!document;
    if (doc === 'documentBack') return !!documentBack;
    if (doc === 'residenceProof') return !!residenceProof;
    return true;
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient
        colors={colors.gradientPrimary}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        {navigation && (
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
        )}
        <View style={styles.headerIcon}>
          <Ionicons name="briefcase" size={32} color="#fff" />
        </View>
        <Text style={styles.headerTitle}>
          {isResubmit ? 'Reenvio de Documentos' : 'Ativar Perfil Profissional'}
        </Text>
        <Text style={styles.headerSub}>
          {isResubmit
            ? 'Envie os documentos solicitados pelo nosso time'
            : 'Envie o comprovante de residência para análise'}
        </Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>

          {isResubmit && resubmitMessage ? (
            <View style={styles.resubmitBox}>
              <Ionicons name="information-circle-outline" size={20} color="#FFA500" />
              <Text style={styles.resubmitText}>{resubmitMessage}</Text>
            </View>
          ) : (
            <View style={styles.infoBox}>
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.infoText}>
                Seus documentos de identidade já foram verificados. Precisamos apenas do seu comprovante de residência para o perfil profissional.
              </Text>
            </View>
          )}

          {requiredDocs.includes('selfie') && (
            <PhotoCard type="selfie" image={selfie}
              label="📸 Selfie" hint="Foto clara do seu rosto" icon="person-circle-outline" />
          )}
          {requiredDocs.includes('document') && (
            <PhotoCard type="document" image={document}
              label="🪪 Documento — Frente" hint="RG, CNH ou Passaporte (frente visível)" icon="card-outline" />
          )}
          {requiredDocs.includes('documentBack') && (
            <PhotoCard type="documentBack" image={documentBack}
              label="🪪 Documento — Verso" hint="Foto do verso do documento" icon="card-outline" />
          )}
          {requiredDocs.includes('residenceProof') && (
            <PhotoCard type="residenceProof" image={residenceProof}
              label="🏠 Comprovante de Residência (obrigatório)"
              hint="Conta de água, luz, gás ou extrato bancário — Foto ou PDF"
              icon="home-outline" />
          )}

          <TouchableOpacity
            style={[styles.submitBtn, (!allDone || loading) && styles.submitBtnDisabled]}
            onPress={handleUpload}
            disabled={!allDone || loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <LinearGradient colors={colors.gradientPrimary} style={styles.submitGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                <Text style={styles.submitText}>Enviar para Análise</Text>
              </LinearGradient>
            )}
          </TouchableOpacity>

          <Text style={styles.footerNote}>
            Após o envio, você continua usando o perfil de cliente normalmente. A análise leva até 24h.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background || '#0F1117' },
  header: { paddingTop: 60, paddingBottom: 28, paddingHorizontal: 24, alignItems: 'center' },
  backBtn: { position: 'absolute', top: 56, left: 20, padding: 4 },
  headerIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff', textAlign: 'center' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 16, gap: 16 },
  infoBox: { flexDirection: 'row', gap: 10, backgroundColor: 'rgba(255,107,0,0.08)', borderRadius: 10, padding: 12, alignItems: 'flex-start' },
  infoText: { flex: 1, fontSize: 13, color: '#ccc', lineHeight: 18 },
  resubmitBox: { flexDirection: 'row', gap: 10, backgroundColor: 'rgba(255,165,0,0.1)', borderRadius: 10, padding: 12, alignItems: 'flex-start', borderWidth: 1, borderColor: 'rgba(255,165,0,0.3)' },
  resubmitText: { flex: 1, fontSize: 13, color: '#FFA500', lineHeight: 18 },
  photoCard: { gap: 6 },
  photoLabel: { fontSize: 14, fontWeight: '600', color: '#fff' },
  photoHint: { fontSize: 12, color: '#888' },
  photoBox: { height: 140, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.12)', borderStyle: 'dashed', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  photoBoxFilled: { borderStyle: 'solid', borderColor: colors.primary },
  photoPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  changeOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', gap: 4 },
  changeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  photoPlaceholder: { alignItems: 'center', gap: 8 },
  photoPlaceholderText: { fontSize: 13, color: '#666' },
  submitBtn: { borderRadius: 12, overflow: 'hidden' },
  submitBtnDisabled: { opacity: 0.5 },
  submitGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  submitText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  footerNote: { fontSize: 12, color: '#666', textAlign: 'center', lineHeight: 17 },
});
