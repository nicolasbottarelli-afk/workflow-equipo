# Harf-Tele — Guía de configuración Firebase

## 1. Crear proyecto en Firebase

1. Ir a https://console.firebase.google.com
2. Clic en **"Agregar proyecto"**
3. Darle un nombre (ej: `harf-tele`) y seguir los pasos
4. Desactivar Google Analytics (no es necesario)

---

## 2. Habilitar Autenticación (Firebase Auth)

1. En el menú lateral → **Autenticación** → **Comenzar**
2. Ir a la pestaña **Método de acceso**
3. Habilitar **"Correo electrónico/contraseña"**
4. Ir a la pestaña **Usuarios** → **Agregar usuario**
5. Agregar el email y contraseña que usarás para entrar (ej: `mbottarelli@harf.com.ar`)

---

## 3. Habilitar Firestore (base de datos)

1. En el menú lateral → **Firestore Database** → **Crear base de datos**
2. Elegir **"Iniciar en modo producción"**
3. Seleccionar la región (recomendado: `southamerica-east1` para Argentina)
4. Una vez creada, ir a **Reglas** y reemplazar el contenido con:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /ciaber/datos {
      allow read, write: if request.auth != null;
    }
  }
}
```

5. Clic en **Publicar**

---

## 4. Habilitar Storage (para adjuntos)

1. En el menú lateral → **Storage** → **Comenzar**
2. Elegir **"Iniciar en modo producción"**
3. Seleccionar la región (la misma que Firestore)
4. Una vez creado, ir a **Reglas** y reemplazar con:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /uploads/{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

5. Clic en **Publicar**

---

## 5. Obtener credenciales y configurar la app

1. En Firebase Console → ⚙️ **Configuración del proyecto** (ícono de engranaje)
2. Bajar hasta **"Tus apps"** → Clic en **"</ >"** (Web)
3. Registrar la app (cualquier nombre)
4. Copiar el objeto `firebaseConfig`

Abrir el archivo `ciaber_app.js` y reemplazar esta sección al inicio:

```javascript
const FIREBASE_CONFIG = {
  apiKey:            "REEMPLAZAR_CON_TU_API_KEY",
  authDomain:        "REEMPLAZAR_CON_TU_AUTH_DOMAIN",
  projectId:         "REEMPLAZAR_CON_TU_PROJECT_ID",
  storageBucket:     "REEMPLAZAR_CON_TU_STORAGE_BUCKET",
  messagingSenderId: "REEMPLAZAR_CON_TU_SENDER_ID",
  appId:             "REEMPLAZAR_CON_TU_APP_ID"
};
```

Con los valores reales de tu proyecto.

---

## 6. Importar datos existentes

Una vez que la app esté funcionando:

1. Abrí la app y entrá con tus credenciales
2. Clic en **⬆ Importar**
3. Seleccioná tu archivo `data.json` actual
4. Los datos migrarán automáticamente a Firebase

---

## 7. Cómo ejecutar la app

La app ya **no necesita servidor Node.js**. Son solo 3 archivos estáticos:

- `ciaber_app.html`
- `ciaber_app.css`
- `ciaber_app.js`

**Opción A — Doble clic (más simple):**
Abrir `ciaber_app.html` directamente en el navegador.
⚠️ Puede haber restricciones CORS. Si hay problemas, usar la opción B.

**Opción B — Live Server (recomendado):**
Instalar la extensión "Live Server" en VS Code y abrir el proyecto.

**Opción C — Firebase Hosting (gratis, acceso desde cualquier lugar):**
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

---

## Características de la nueva versión

- ✅ **Base de datos en la nube** — Firebase Firestore, sin pérdida de datos
- ✅ **Sincronización en tiempo real** — los cambios se reflejan al instante
- ✅ **Persistencia offline** — funciona sin internet, sincroniza al volver
- ✅ **Archivos adjuntos en la nube** — Firebase Storage, accesibles desde cualquier dispositivo
- ✅ **Autenticación real** — Firebase Auth con email/contraseña
- ✅ **Barra de progreso** por proyecto
- ✅ **Toasts de notificación** en lugar de alerts
- ✅ **Sin servidor Node.js** — app 100% estática
- ✅ **Backup automático** en cada guardado (Firestore conserva historial de versiones)
- ✅ **Fecha de terminado automática** al marcar como Cobrado/Terminado
