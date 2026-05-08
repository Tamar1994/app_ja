import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Image, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../context/AuthContext';
import { uploadDocuments, userAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius } from '../../theme';

export default function DocumentUploadScreen({ navigation }) {
  const { user, setUser } = useAuth();
  const [selfie, setSelfie] = useState(null);
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async (type) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', 'Precisamos de acesso às suas fotos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: type === 'selfie' ? [1, 1] : [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      if (type === 'selfie') setSelfie(result.assets[0]);
      else setDocument(result.assets[0]);
    }
  };

  const takePhoto = async (type) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', 'Precisamos de acesso à câmera.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: type === 'selfie' ? [1, 1] : [4, 3],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      if (type === 'selfie') setSelfie(result.assets[0]);
      else setDocument(result.assets[0]);
    }
  };

  const showImageOptions = (type) => {
    Alert.alert('Adicionar foto', 'Como deseja adicionar?', [
      { text: 'Câmera', onPress: () => takePhoto(type) },
      { text: 'Galeria', onPress: () => pickImage(type) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const handleUpload = async () => {
    if (!selfie || !document) {
      Alert.alert('Atenção', 'Envie a selfie e a foto do documento.');
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('selfie', {
        uri: selfie.uri,
        type: 'image/jpeg',
        name: 'selfie.jpg',
      });
      formData.append('document', {
        uri: document.uri,
        type: 'image/jpeg',
        name: 'document.jpg',
      });
      const res = await uploadDocuments(formData);
      if (setUser) setUser(prev => ({ ...prev, verificationStatus: 'pending_review' }));
      navigation.replace('PendingApproval');
    } catch (err) {
      // No Android, o FormData multipart às vezes lança erro mesmo após upload bem-sucedido
      if (!err.response) {
        try {
          const { data } = await userAPI.getMe();
          if (data.user?.verificationStatus === 'pending_review') {
            if (setUser) setUser(data.user);
            navigation.replace('PendingApproval');
            return;
          }
        } catch {}
      }
      Alert.alert('Erro', err.response?.data?.message || 'Erro ao enviar documentos. Tente novamente.');
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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient
        colors={colors.gradientPrimary}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.headerIcon}>
          <Ionicons name="shield-checkmark" size={32} color="#fff" />
        </View>
        <Text style={styles.headerTitle}>Verificação de identidade</Text>
        <Text style={styles.headerSub}>Seus dados estão protegidos por criptografia</Text>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <View style={styles.infoBox}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.primary} />
            <Text style={styles.infoText}>
              Esta etapa é necessária para garantir a segurança de todos os usuários da plataforma.
            </Text>
          </View>

          <PhotoCard
            type="selfie"
            image={selfie}
            label="📸 Selfie"
            hint="Foto do seu rosto em local bem iluminado"
            icon="person-circle-outline"
          />

          <PhotoCard
            type="document"
            image={document}
            label="🪪 Documento oficial"
            hint="RG, CNH ou Passaporte (frente visível)"
            icon="card-outline"
          />

          <TouchableOpacity
            style={[styles.btn, (!selfie || !document || loading) && styles.btnDisabled]}
            onPress={handleUpload}
            disabled={!selfie || !document || loading}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={(!selfie || !document || loading) ? ['#ccc', '#bbb'] : colors.gradientPrimary}
              style={styles.btnGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <>
                    <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                    <Text style={styles.btnText}>Enviar para análise</Text>
                  </>
              }
            </LinearGradient>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            Seus documentos serão analisados em até 24 horas por nossa equipe. Você receberá um e-mail com o resultado.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: 60,
    paddingBottom: 32,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  headerIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: typography.fontSizes.xxl,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 6,
    textAlign: 'center',
  },
  headerSub: {
    fontSize: typography.fontSizes.sm,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
  },
  scroll: { flexGrow: 1 },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    padding: spacing.xl,
    marginTop: -20,
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: `${colors.primary}12`,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.xl,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  infoText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  photoCard: { marginBottom: spacing.xl },
  photoLabel: {
    fontSize: typography.fontSizes.md,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  photoHint: {
    fontSize: typography.fontSizes.sm,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  photoBox: {
    height: 180,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  photoBoxFilled: {
    borderStyle: 'solid',
    borderColor: colors.primary,
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  photoPlaceholderText: {
    fontSize: typography.fontSizes.sm,
    color: colors.textLight,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  changeOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  changeText: { color: '#fff', fontSize: typography.fontSizes.sm, fontWeight: '600' },
  btn: { borderRadius: borderRadius.lg, overflow: 'hidden', marginBottom: spacing.md },
  btnDisabled: { opacity: 0.5 },
  btnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
  },
  btnText: { color: '#fff', fontSize: typography.fontSizes.md, fontWeight: '700' },
  disclaimer: {
    fontSize: typography.fontSizes.xs,
    color: colors.textLight,
    textAlign: 'center',
    lineHeight: 18,
  },
});
