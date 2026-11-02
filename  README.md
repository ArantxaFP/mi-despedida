# Mi Despedida

**Trabajo Final de Máster (TFM) — Universitat Oberta de Catalunya (UOC)**  
**Entrega: PAC2 — 2 de noviembre de 2026**

**AVISO IMPORTANTE.** Mi Despedida es un proyecto académico en fase de desarrollo y pruebas. 
**No es una aplicación operativa abierta al público.** No se deben introducir datos personales reales, contactos de terceros ni mensajes privados, ni confiar en esta aplicación para el envío futuro de mensajes.
**NO ESTÁ PERMITIDA LA COPIA O EL USO DE ESTE CÓDIGO MÁS ALLÁ DEL PERSONAL AUTORIZADO DE LA UOC**


## 1. Descripción

Mi Despedida es un prototipo de aplicación web para preparar mensajes personales de despedida, gestionar contactos destinatarios y autorizar a personas de confianza (lanzadores) para participar en un eventual procedimiento de activación. 
La PAC2 comprende la estructura técnica, parte del backoffice y parte de la web comercial, y los recorridos funcionales implementados hasta la entrega. **Los procedimientos automáticos de activación de envío de mensajes de despedida y confirmaciín de envío de despedida no deben darse por operativos en esta fase.**

El proyecto se divide en tres aplicaciones independientes, ubicadas en el mismo repositorio:

| Carpeta       | Aplicación                                | Tecnología                         | Puerto local |
|---------------|-------------------------------------------|------------------------------------|--------------|
| `web/`        | Web comercial                             | Angular 22, TypeScript, HTML, SCSS | `4201`.      |
| `backoffice/` | Gestión de usuarios, contactos y mensajes | Angular 22, TypeScript, HTML, SCSS | `4200`       |
| `backend/`    | API y lógica de servidor                  | NestJS, Node.js, TypeScript        | `3000`       |

Servicios externos utilizados en el proyecto: PostgreSQL/Supabase, Supabase Auth, Prisma, Brevo, Netlify y Render. Git/GitHub se utiliza para versionado de repositorio.

## 2. Requisitos previos

- **Node.js 22** (versión utilizada durante el desarrollo: `v22.22.3`).
- **npm 10** (versión utilizada durante el desarrollo: `10.9.8`).
- Terminal y editor de código, VS Code.
- Conexión a Internet para instalar dependencias y acceder a los servicios alojados.
- **Solo si se desean ejecutar funciones que acceden a datos o autenticación:** configuración válida de Supabase, base de datos y demás servicios externos. El código por sí solo no permite reproducir estos servicios.

Comprobar versiones:

```powershell
node --version
npm --version
```

No es necesario instalar Angular CLI ni NestJS CLI globalmente si se utilizan los scripts npm de cada aplicación. `npm ci` instalará las dependencias indicadas en los respectivos archivos `package-lock.json`.

## 3. Preparación del proyecto

Descomprimir el ZIP en una carpeta de trabajo y abrir una terminal en la raíz `mi-despedida/`.

**Importante:** las tres aplicaciones tienen sus propios `package.json` y `package-lock.json`. 
Hay que instalar las dependencias por separado:

```powershell
cd backend
npm ci
cd ../backoffice
npm ci
cd ../web
npm ci
cd ..
```

Si `npm ci` indica que `package.json` y `package-lock.json` no coinciden, debe revisarse el archivo de bloqueo de la aplicación correspondiente; no es recomendable solucionarlo borrándolo en la entrega.

## 4. Ejecutar en local

Abrir **tres terminales independientes** en la raíz del proyecto.

### Terminal 1 — Backend

```powershell
cd backend
npm run start:dev
```

Dirección prevista: `http://localhost:3000/`.

**Atención:** para iniciar la API con funcionalidades reales se necesitan las variables de entorno del servidor. Si no están configuradas, el proceso puede fallar al iniciar o al consultar ciertos endpoints. La API está pensada para trabajar con los servicios externos configurados en el proyecto.

### Terminal 2 — Backoffice

```powershell
cd backoffice
npm start -- --port 4200
```

Dirección: `http://localhost:4200/`.

### Terminal 3 — Web comercial

```powershell
cd web
npm start -- --port 4201
```

Dirección: `http://localhost:4201/`.

Alternativamente, desde cada aplicación Angular se puede utilizar `npx ng serve --port 4200` o `npx ng serve --port 4201`, respectivamente.

Los puertos `4200` y `4201` deben estar libres. Si se cambia alguno, habrá que ajustar también los enlaces locales entre la web comercial y el backoffice en los archivos de configuración de cada aplicación.

## 5. Compilar los tres proyectos

Desde la raíz, ejecutar en cada aplicación:

```powershell
cd web
npm run build
cd ../backoffice
npm run build
cd ../backend
npm run build
cd ..
```

Los dos proyectos Angular generan su salida bajo sus respectivas carpetas `dist/`; el backend genera la compilación en `backend/dist/` según su configuración. 

La compilación permite comprobar estructura, imports y errores de TypeScript/Angular, pero **no garantiza por sí sola que funcionen los servicios externos**, que requieren configuración y credenciales válidas.

## 6. Configuración y variables de entorno

### 6.1. Qué se entrega y qué no

Por seguridad **no se incluyen en el ZIP** archivos `.env` reales, contraseñas, claves privadas, tokens ni cadenas de conexión de base de datos. Tampoco se deben adjuntar copias de credenciales de Supabase o Brevo. Si se tuviera que proporcionar el archivo .env con las keys, lo haría en cuanto se indicase.

Para reproducir íntegramente registro, inicio de sesión, operaciones sobre datos e invitaciones, se requiere una configuración autorizada para acceder a los servicios necesarios.

### 6.2. Qué debe revisar quien lo instale

- **Backend:** revisar los nombres de variables que lee el código (`process.env`, módulo de configuración, Prisma) y configurar sus valores en un archivo local `.env` o en el entorno del sistema. Entre las categorías que pueden requerirse están la conexión a PostgreSQL/Supabase, autenticación y servicios de envío de correo. Los nombres exactos han de comprobarse en el código entregado.
- **Angular:** comprobar las URL utilizadas para comunicarse con el backend y con Supabase. Una compilación local no implica necesariamente que las llamadas apunten a `localhost:3000`; las URL de API deben coincidir con el entorno de prueba.
- **Enlaces entre aplicaciones:** en local, la web comercial utiliza el puerto `4201` y el backoffice `4200`. En producción se usan sus respectivos dominios de Netlify.
- **Base de datos:** el esquema Prisma y las migraciones presentes en el repositorio deben revisarse antes de ejecutarse contra cualquier base de datos. No ejecutar migraciones sobre bases compartidas o de producción sin autorización.

**No se incluyen secretos en el README.** Si el profesorado de la UOC necesita probar operaciones reales, se les pueden proporcionar las claves y también si lo requieren los accesos personales a todos los servicios externos (Render, Supabase, Brevo o Netlify).

### 6.3. Prisma

El backend contiene el esquema y las dependencias Prisma. Desde `backend/` puede generarse el cliente con:

```powershell
npx prisma generate
```

Para aplicar migraciones **solo en una base de datos de prueba, previamente configurada y autorizada**, comprobar primero la estructura existente en `backend/prisma/`. Si hay migraciones versionadas y el proyecto las utiliza:

```powershell
npx prisma migrate deploy
```

**No ejecutar `prisma migrate reset`, `db push` o acciones destructivas sobre la base de datos original.** No existe una base de datos de pruebas preparada o un backup que se pueda levantar de nuevo para reemplazar la configurada actualmente.

## 7. Funcionalidades y límites de la PAC2

El trabajo entregado incluye una estructura técnica de tres aplicaciones y avances de interfaz y lógica para registro/acceso, perfil, gestión de contactos, mensajes individuales e invitaciones/autorizaciones de lanzadores, además de una primera web comercial con capturas y apartados con estilos provisionales.

La presencia de una pantalla o de una ruta no debe interpretarse como que todo su recorrido esté implementado y validado. Entre los elementos previstos para fases posteriores figuran el proceso de activación independiente por dos lanzadores, el periodo de seguridad, la ejecución automática del envío y las comprobaciones de seguridad e integración completas. Los apartados **«Coming soon»** de la web comercial identifican contenido pendiente.

Consultar la memoria y documentación de la PAC2 para el detalle del alcance, las decisiones de arquitectura, los estados previstos y las pruebas realizadas.

## 8. Entornos publicados

- Web comercial: https://mi-despedida.netlify.app/
- Backoffice: https://gestion-mi-despedida.netlify.app/
- Backend desplegado en Render: https://mi-despedida-backend.onrender.com/
- Github público: https://github.com/ArantxaFP/mi-despedida

Los servicios publicados pueden variar o quedar suspendidos por tratarse de un proyecto académico. Las direcciones anteriores son referencias del entorno de desarrollo y demostración, no una garantía de disponibilidad.

## 9. Estructura recomendada del ZIP de código

```text
mi-despedida/
├── README.md
├── .gitignore
├── web/
│   ├── angular.json
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig*.json
│   ├── public/                 # Imágenes y capturas usadas por la web
│   └── src/                    # Código Angular, HTML y SCSS
├── backoffice/
│   ├── angular.json
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig*.json
│   ├── public/                 
│   └── src/                    # Código Angular, HTML y SCSS
└── backend/
    ├── package.json
    ├── package-lock.json
    ├── tsconfig*.json
    ├── nest-cli.json          
    ├── prisma/                # Esquema y migraciones, si existen
    ├── src/                   # Código NestJS
    └── test/                  # Si existe
```

---

**Nota para la evaluación:** La entrega corresponde al estado del proyecto en PAC2, no a una versión final destinada a usuarios reales. La memoria de la PAC2 detalla las funcionalidades completadas y las pendientes.

**AVISO IMPORTANTE:** De todos los servicios externos se está usando la versión gratuita por lo que hay limitaciones y se requiere precaución en su uso así como paciencia si en el inicio de la prueba se requiere de un leve tiempo de espera.

© Aránzazu Fernández Pérez
Reservados todos los derechos. Está prohibido la reproducción total o parcial de esta obra por cualquier medio o procedimiento, comprendidos la impresión, la reprografía, el microfilme, el tratamiento informático o cualquier otro sistema, así como la distribución de ejemplares mediante alquiler y préstamo, sin la autorización escrita del autor o de los límites que autorice la Ley de Propiedad Intelectual.

