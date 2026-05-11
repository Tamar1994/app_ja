import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, Image, StatusBar, FlatList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { requestAPI } from '../../services/api';
import { colors, typography, spacing, borderRadius } from '../../theme';

export default function CompletionPhotosScreen({ navigation, route }) {
  const { requestId } = route.params;
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);

  const MAX_PHOTOS = 5;

  const pickPhotos = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', 'Precisamos de acesso às suas fotos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: MAX_PHOTOS - photos.length,
    });
    if (!result.canceled && result.assets?.length) {
      setPhotos(prev => [...prev, ...result.assets].slice(0, MAX_PHOTOS));
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
      setPhotos(prev => [...prev, result.assets[0]].slice(0, MAX_PHOTOS));
    }
  };

  const removePhoto = (index) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    Alert.alert('Adicionar foto', 'Como deseja adicionar?', [
      { text: 'Câmera', onPress: takePhoto },
      { text: 'Galeria', onPress: pickPhotos },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const handleUpload = async () => {
    if (photos.length === 0) {
      handleSkip();
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      photos.forEach((p, i) => {
        formData.append('photos', {
          uri: p.uri,
          type: 'image/jpeg',
          name: `completion_${i}.jpg`,
        });
      });
      await requestAPI.uploadCompletionPhotos(requestId, formData);
      navigation.replace('ProfessionalReview', { requestId });
    } catch (err) {
      Alert.alert('Erro', err.response?.data?.message || 'Erro ao enviar fotos. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    navigation.replace('ProfessionalReview', { requestId });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient
        colors={colors.gradientSecondary}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Ionicons name="camera" size={32} color="#fff" />
        <Text style={styles.headerTitle}>Comprove o serviço concluído</Text>
        <Text style={styles.headerSub}>Adicione fotos do serviço realizado (opcional)</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          {photos.map((p, i) => (
            <View key={i} style={styles.photoWrap}>
              <Image source={{ uri: p.uri }} style={styles.photo} />
              <TouchableOpacity style={styles.removeBtn} onPress={() => removePhoto(i)}>
                <Ionicons name="close-circle" size={22} color="#f44336" />
              </TouchableOpacity>
            </View>
          ))}
          {photos.length < MAX_PHOTOS && (
            <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
              <Ionicons name="add" size={36} color={colors.secondary} />
              <Text style={styles.addText}>{photos.length === 0 ? 'Adicionar fotos' : 'Mais'}</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.counter}>{photos.length}/{MAX_PHOTOS} fotos</Text>

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleUpload}
          disabled={loading}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={loading ? ['#ccc', '#bbb'] : colors.gradientSecondary}
            style={styles.btnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                  <Text style={styles.btnText}>
                    {photos.length > 0 ? 'Enviar fotos' : 'Continuar sem fotos'}
                  </Text>
                </>
            }
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
          <Text style={styles.skipText}>Pular esta etapa</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: { ...typography.h2, color: '#fff', textAlign: 'center', marginTop: 8 },
  headerSub: { ...typography.body, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  scroll: { padding: spacing.lg, gap: spacing.md },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  photoWrap: { position: 'relative', width: 100, height: 100 },
  photo: { width: 100, height: 100, borderRadius: borderRadius.md },
  removeBtn: { position: 'absolute', top: -8, right: -8, backgroundColor: '#fff', borderRadius: 11 },
  addBtn: {
    width: 100,
    height: 100,
    borderRadius: borderRadius.md,
    borderWidth: 2,
    borderColor: colors.secondary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { ...typography.caption, color: colors.secondary, marginTop: 4 },
  counter: { ...typography.caption, color: colors.textLight, textAlign: 'center' },
  btn: { marginTop: spacing.md },
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
  skipBtn: { alignItems: 'center', paddingVertical: spacing.md },
  skipText: { ...typography.body, color: colors.textLight },
});
