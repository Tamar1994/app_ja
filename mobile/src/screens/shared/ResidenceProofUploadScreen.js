import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Image, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { uploadResidenceProof, userAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius } from '../../theme';

export default function ResidenceProofUploadScreen({ navigation }) {
  const { setUser } = useAuth();
  const [file, setFile] = useState(null); // { uri, type, name, isImage }
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', 'Precisamos de acesso às suas fotos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setFile({ uri: asset.uri, type: 'image/jpeg', name: 'residencia.jpg', isImage: true });
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', 'Precisamos de acesso à câmera.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setFile({ uri: asset.uri, type: 'image/jpeg', name: 'residencia.jpg', isImage: true });
    }
  };

  const pickPDF = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setFile({ uri: asset.uri, type: 'application/pdf', name: asset.name || 'residencia.pdf', isImage: false });
    }
  };

  const showOptions = () => {
    Alert.alert('Comprovante de residência', 'Como deseja enviar?', [
      { text: 'Câmera', onPress: takePhoto },
      { text: 'Galeria', onPress: pickImage },
      { text: 'PDF', onPress: pickPDF },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const handleUpload = async () => {
    if (!file) {
      Alert.alert('Atenção', 'Selecione o comprovante de residência.');
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('residenceProof', { uri: file.uri, type: file.type, name: file.name });
      await uploadResidenceProof(formData);
      const { data } = await userAPI.getMe();
      if (setUser) setUser(data.user);
      Alert.alert('Enviado!', 'Comprovante enviado com sucesso.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Erro', err.response?.data?.message || 'Erro ao enviar comprovante. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient
        colors={colors.gradientPrimary}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Ionicons name="home" size={32} color="#fff" />
          <Text style={styles.headerTitle}>Comprovante de residência</Text>
          <Text style={styles.headerSub}>Conta de água, luz, gás ou telefone fixo</Text>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.fileBox} onPress={showOptions} activeOpacity={0.8}>
          {file ? (
            file.isImage ? (
              <Image source={{ uri: file.uri }} style={styles.preview} resizeMode="contain" />
            ) : (
              <View style={styles.pdfPreview}>
                <Ionicons name="document" size={48} color={colors.primary} />
                <Text style={styles.pdfName} numberOfLines={2}>{file.name}</Text>
              </View>
            )
          ) : (
            <View style={styles.placeholder}>
              <Ionicons name="cloud-upload-outline" size={48} color={colors.primary} />
              <Text style={styles.placeholderText}>Toque para selecionar{'\n'}Foto ou PDF</Text>
            </View>
          )}
        </TouchableOpacity>

        {file && (
          <TouchableOpacity style={styles.changeBtn} onPress={showOptions}>
            <Text style={styles.changeBtnText}>Trocar arquivo</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.btn, (!file || loading) && styles.btnDisabled]}
          onPress={handleUpload}
          disabled={!file || loading}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={(!file || loading) ? ['#ccc', '#bbb'] : colors.gradientPrimary}
            style={styles.btnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                  <Text style={styles.btnText}>Enviar comprovante</Text>
                </>
            }
          </LinearGradient>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          O documento deve estar no seu nome e emitido nos últimos 3 meses.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingBottom: spacing.xl, paddingHorizontal: spacing.lg },
  backBtn: { paddingTop: spacing.sm, marginBottom: spacing.sm },
  headerContent: { alignItems: 'center', gap: 8 },
  headerTitle: { ...typography.h2, color: '#fff', textAlign: 'center', marginTop: 8 },
  headerSub: { ...typography.body, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  scroll: { padding: spacing.lg, gap: spacing.md },
  fileBox: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: borderRadius.lg,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  preview: { width: '100%', height: 220 },
  pdfPreview: { alignItems: 'center', gap: 12, padding: spacing.xl },
  pdfName: { ...typography.body, color: colors.text, textAlign: 'center' },
  placeholder: { alignItems: 'center', gap: 12, padding: spacing.xl },
  placeholderText: { ...typography.body, color: colors.textLight, textAlign: 'center' },
  changeBtn: { alignItems: 'center' },
  changeBtnText: { ...typography.body, color: colors.primary },
  btn: {},
  btnDisabled: { opacity: 0.6 },
  btnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: borderRadius.lg,
  },
  btnText: { ...typography.button, color: '#fff' },
  disclaimer: { ...typography.caption, color: colors.textLight, textAlign: 'center' },
});
