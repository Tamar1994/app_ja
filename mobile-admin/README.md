# Já! Suporte — App interno de atendimento

APK para uso interno exclusivo da equipe de suporte.

## Para rodar localmente (teste)

```bash
cd mobile-admin
npm install
npx expo start --android
```

Configure a URL da API criando o arquivo `.env`:
```
EXPO_PUBLIC_API_URL=https://ja-backend-gpow.onrender.com/api
```

## Para gerar APK

1. Instale EAS CLI: `npm install -g eas-cli`
2. Login: `eas login`
3. Build: `npx eas build --platform android --profile apk`
4. Baixe o `.apk` gerado e instale nos celulares dos admins

## Login

Use as mesmas credenciais do painel admin web (`/api/admin/login`).  
O usuário precisa ter permissão `support_chat` (role `support` ou `super_admin`).

## Funcionalidades

- Login com e-mail e senha de admin
- Toggle Online/Offline para receber atendimentos
- Lista de chats atribuídos (atualiza em tempo real via socket)
- Indicador visual de chats P1 (emergência)
- Chat com mensagens em tempo real (socket + polling de fallback)
- Encerrar atendimento
- Contadores: ativos, P1, respondidos
