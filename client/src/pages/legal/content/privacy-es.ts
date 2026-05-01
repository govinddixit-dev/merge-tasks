// content/privacy-es.ts
// Source of truth: MergeTasks_Politica_Privacidad_ES.pdf — Fecha de vigencia: 8 de abril de 2026

export const privacyES = {
  title: "Política de Privacidad",
  subtitle: "Plataforma MergeTasks",
  effectiveDate: "Fecha de vigencia: 8 de abril de 2026",
  summaryBox: {
    heading: "Privacidad de un vistazo",
    points: [
      "Recopilamos únicamente lo necesario para operar la plataforma MergeTasks.",
      "Ciframos sus datos sensibles con cifrado estándar de la industria AES-256-GCM.",
      "Nunca vendemos su información personal — a nadie, por ningún motivo.",
      "Usted es dueño de sus datos. Puede exportarlos o eliminarlos en cualquier momento.",
      "Cuando procesamos datos en nombre de los Distribuidores, actuamos estrictamente como encargado del tratamiento conforme a sus instrucciones.",
    ],
  },
  intro: "MergeTasks (\"MergeTasks\", \"nosotros\", \"nos\" o \"nuestro\") es una empresa canadiense con sede en Ontario, Canadá. Operamos una plataforma de software como servicio (SaaS) diseñada para distribuidores de productos promocionales en América del Norte. Esta Política de Privacidad describe cómo recopilamos, usamos, divulgamos y protegemos la información personal cuando usted utiliza nuestra plataforma, sitio web y servicios relacionados (en conjunto, la \"Plataforma\"). Estamos comprometidos con la protección de su privacidad y el manejo transparente de su información personal, de conformidad con las leyes de privacidad aplicables, incluida la PIPEDA, la CCPA/CPRA y el GDPR. Si tiene preguntas o inquietudes, contáctenos en privacy@mergetasks.com.",
  sections: [
    {
      number: "1",
      title: "Información que Recopilamos",
      content: [
        { number: "1.1", text: "Información que Usted Proporciona Directamente — Información de la cuenta del Distribuidor. Cuando un Distribuidor se registra en la Plataforma, recopilamos: nombre completo y dirección de correo electrónico; contraseña (almacenada únicamente como hash bcrypt — nunca almacenamos contraseñas en texto plano); nombre de la organización, dirección postal y número de teléfono; información de facturación procesada a través de Stripe; ID de cuenta de Stripe Connect; credenciales SMTP cifradas con AES-256-GCM en reposo." },
        { number: "1.2", text: "Información Recopilada Automáticamente. Cuando usted utiliza la Plataforma, recopilamos automáticamente cierta información técnica y de uso: marcas de tiempo de inicio de sesión y actividad de sesión; patrones de uso de funcionalidades e historial de interacción con el copiloto de IA; información del dispositivo, tipo de navegador y sistema operativo; dirección IP y ubicación geográfica aproximada; datos de errores y rendimiento (recopilados a través de Sentry)." },
        { number: "1.3", text: "Información de Servicios de Terceros. Recibimos información limitada de los siguientes servicios de terceros cuando está autorizado por el usuario: Stripe (IDs de transacciones de pago, estado de suscripción — MergeTasks nunca recibe ni almacena números de tarjetas de crédito en bruto); QuickBooks Online (registros de clientes, facturas, pagos — solo cuando está autorizado explícitamente por el Distribuidor mediante consentimiento OAuth 2.0); Proveedores de identidad SSO (dirección de correo electrónico, nombre y opcionalmente atributos de departamento y cargo — MergeTasks nunca recibe ni almacena la contraseña del proveedor de identidad del usuario); OpenAI (prompts y respuestas generadas a través de las funcionalidades del copiloto de IA — contexto de productos/negocios únicamente)." },
        { number: "1.4", text: "Información que Procesamos en Nombre de los Distribuidores. Cuando los Distribuidores utilizan la Plataforma para gestionar su negocio, procesamos ciertos datos en su nombre. En este contexto, el Distribuidor es el controlador de datos y MergeTasks actúa como encargado del tratamiento. Estos datos incluyen: nombre de la empresa cliente, nombre del contacto, correo electrónico, teléfono y dirección; historial de propuestas y pedidos; datos de facturación; límites de gasto y saldos de puntos de los usuarios finales; historial de pedidos de los usuarios finales; información de identidad SSO." },
      ],
    },
    {
      number: "2",
      title: "Cómo Usamos su Información",
      content: [
        { number: "2.1", text: "Provisión y Operación de la Plataforma. Para crear y mantener su cuenta, entregar las funcionalidades y servicios que solicita, y administrar las tiendas en línea operadas por los Distribuidores." },
        { number: "2.2", text: "Procesamiento de Pagos. Para procesar pagos de suscripción y facilitar transacciones entre Distribuidores y sus usuarios finales a través de Stripe." },
        { number: "2.3", text: "Sincronización de Datos Contables. Para sincronizar datos de clientes, facturas, estimaciones y pagos entre MergeTasks y la cuenta de QuickBooks Online de un Distribuidor, según las instrucciones y autorización del Distribuidor." },
        { number: "2.4", text: "Autenticación de Usuarios. Para verificar su identidad mediante correo electrónico/código de un solo uso, autenticación por contraseña o SSO a través del proveedor de identidad de su organización." },
        { number: "2.5", text: "Comunicaciones Transaccionales. Para enviar confirmaciones de pedidos, códigos de un solo uso, notificaciones de reembolso y otros mensajes relacionados con el servicio." },
        { number: "2.6", text: "Mejora de la Plataforma. Para analizar patrones de uso, monitorear errores (a través de Sentry) y mejorar la confiabilidad, el rendimiento y las funcionalidades de la Plataforma." },
        { number: "2.7", text: "Funcionalidades Impulsadas por IA. Para generar sugerencias de contenido, pruebas virtuales de productos y recomendaciones de optimización de tiendas usando OpenAI. Estas funcionalidades procesan el contexto de productos y negocios — los datos personales no se incluyen intencionalmente en los prompts de IA." },
        { number: "2.8", text: "Seguridad y Prevención de Abusos. Para hacer cumplir nuestros Términos de Servicio, prevenir fraudes, detectar accesos no autorizados y proteger la seguridad de la Plataforma y sus usuarios." },
        { number: "2.9", text: "Cumplimiento Legal. Para cumplir con las leyes, regulaciones, procesos legales y solicitudes gubernamentales ejecutables aplicables." },
      ],
    },
    {
      number: "3",
      title: "Cómo Compartimos su Información",
      content: [
        { number: "3.1", text: "No vendemos información personal. MergeTasks nunca ha vendido información personal y no tiene planes de hacerlo. Esto se aplica a todas las categorías de información personal que recopilamos, para todos los usuarios." },
        { number: "3.2", text: "Proveedores de Servicios. Compartimos información personal con proveedores de servicios de terceros de confianza que realizan servicios en nuestro nombre, sujeto a obligaciones contractuales para proteger sus datos: Stripe (procesamiento de pagos); OpenAI (funcionalidades del copiloto de IA); Sentry (monitoreo de errores); Proveedores SMTP (entrega de correos electrónicos transaccionales)." },
        { number: "3.3", text: "Por Instrucción del Distribuidor. Cuando un Distribuidor autoriza una integración de terceros, compartimos datos según sus instrucciones: QuickBooks Online (datos de clientes, facturas y pagos sincronizados bidireccionalmente); Proveedores de identidad SSO (solicitudes de autenticación e intercambio de atributos según la configuración del Distribuidor)." },
        { number: "3.4", text: "Requisitos Legales. Podemos divulgar información personal si así lo exige la ley, o si creemos de buena fe que dicha acción es necesaria para cumplir con una obligación legal, proteger y defender nuestros derechos o propiedad, prevenir fraudes, actuar en circunstancias urgentes para proteger la seguridad personal, o responder a una orden judicial, citación u otra solicitud gubernamental legal." },
        { number: "3.5", text: "Transferencias de Negocios. En relación con una fusión, adquisición, reorganización, venta de activos o quiebra, la información personal puede ser transferida a la entidad adquirente. Proporcionaremos aviso antes de que su información personal quede sujeta a una política de privacidad diferente." },
      ],
    },
    {
      number: "4",
      title: "Roles en el Tratamiento de Datos",
      content: [
        { number: "4.1", text: "MergeTasks como Controlador de Datos. MergeTasks actúa como controlador de datos para: datos de registro y perfil de la cuenta del Distribuidor; datos de uso de la Plataforma y análisis; información de facturación y suscripción; comunicaciones entre MergeTasks y los Distribuidores." },
        { number: "4.2", text: "MergeTasks como Encargado del Tratamiento. MergeTasks actúa como encargado del tratamiento para: datos de clientes del Distribuidor (información de la empresa, contactos, propuestas, pedidos, facturas); datos de usuarios finales en las tiendas en línea operadas por los Distribuidores; datos sincronizados con QuickBooks Online según las instrucciones del Distribuidor; atributos de identidad SSO recibidos del proveedor de identidad configurado por el Distribuidor." },
        { number: "4.3", text: "Responsabilidades del Distribuidor. Los Distribuidores, como controladores de datos de sus clientes y datos de usuarios finales, son responsables de: obtener todos los consentimientos necesarios o establecer una base legal para el procesamiento; proporcionar avisos de privacidad apropiados a sus clientes y usuarios finales; responder a las solicitudes de acceso de los interesados relacionadas con los datos que controlan." },
        { number: "4.4", text: "Procesamiento de Datos de QuickBooks. El acceso a los datos de QuickBooks Online de un Distribuidor requiere la autorización OAuth 2.0 explícita del Distribuidor. Los tokens de acceso y actualización de OAuth están cifrados con AES-256-GCM en reposo. Al desconectarse, los mapeos de sincronización y los datos de QuickBooks en caché se eliminan." },
      ],
    },
    {
      number: "5",
      title: "Servicios de Terceros e Integraciones",
      content: [
        { number: "5.1", text: "Stripe. Stripe procesa todas las transacciones de pago en la Plataforma. MergeTasks almacena IDs de clientes de Stripe, identificadores de suscripción, IDs de cuentas Connect y referencias de transacciones — pero nunca números de tarjetas de crédito en bruto, CVVs u otros datos sensibles de tarjetas de pago. Política de Privacidad de Stripe: https://stripe.com/privacy" },
        { number: "5.2", text: "QuickBooks Online (Intuit). La integración de QuickBooks Online permite la sincronización bidireccional de datos de clientes, facturas, estimaciones y pagos. La integración requiere la autorización OAuth 2.0 explícita del Distribuidor. Los tokens OAuth están cifrados con AES-256-GCM en reposo y transmitidos a través de TLS 1.2+. Declaración de Privacidad de Intuit: https://www.intuit.com/privacy/" },
        { number: "5.3", text: "Proveedores de Identidad SSO (Okta, Microsoft Azure AD, Google Workspace). Los Distribuidores pueden configurar SSO para autenticar a sus usuarios finales mediante SAML 2.0 u OpenID Connect (OIDC). MergeTasks recibe la dirección de correo electrónico, el nombre y opcionalmente los atributos de departamento y cargo. MergeTasks nunca recibe, almacena ni tiene acceso a la contraseña del proveedor de identidad del usuario." },
        { number: "5.4", text: "OpenAI. OpenAI impulsa las funcionalidades del copiloto de IA de la Plataforma. Los prompts enviados a OpenAI contienen información del catálogo de productos y contexto empresarial. No se incluyen datos personales intencionalmente en los prompts. Políticas de Uso de OpenAI: https://openai.com/policies/usage-policies" },
      ],
    },
    {
      number: "6",
      title: "Seguridad de los Datos",
      content: [
        { number: "6.1", text: "Cifrado. En reposo: los tokens OAuth, las credenciales SMTP y los secretos de clientes SSO están cifrados con AES-256-GCM. En tránsito: todos los datos se transmiten a través de TLS 1.2 o superior. Contraseñas: almacenadas como hashes bcrypt — nunca en texto plano. Códigos de un solo uso: hasheados con SHA-256 antes del almacenamiento." },
        { number: "6.2", text: "Controles de Acceso. Controles de acceso basados en roles con aislamiento de datos por organización (multi-tenencia). Bloqueo de cuenta después de 10 intentos de inicio de sesión consecutivos fallidos. Tokens de sesión de corta duración (tokens de acceso de 15 minutos, tokens de actualización de 7 días) con revocación del lado del servidor. Protección CSRF utilizando el patrón de doble envío de cookies." },
        { number: "6.3", text: "Monitoreo y Registro. Registro de auditoría completo para eventos de autenticación, cambios de configuración de pago, exportaciones de datos y eventos SSO. Monitoreo de errores a través de Sentry para identificación y remediación rápida de problemas." },
        { number: "6.4", text: "Notificación de Violación. En caso de una violación de datos que afecte su información personal, notificaremos a los usuarios afectados y a las autoridades reguladoras aplicables dentro de las 72 horas posteriores a tener conocimiento de la violación, de conformidad con los requisitos de PIPEDA, CCPA/CPRA y GDPR." },
      ],
    },
    {
      number: "7",
      title: "Retención de Datos",
      content: [
        { number: "7.1", text: "Retenemos la información personal solo durante el tiempo necesario para cumplir con los propósitos descritos en esta Política de Privacidad, o según lo exija la ley. Períodos de retención: datos de cuenta — período de cuenta activa + 90 días después de la terminación; códigos de verificación (OTP) — eliminados automáticamente después de su vencimiento; tokens de actualización — eliminados automáticamente 7 días después de su vencimiento; registros de auditoría — mínimo 90 días; mapeos de sincronización de QuickBooks — eliminados cuando el Distribuidor desconecta QuickBooks; configuraciones de proveedores SSO — eliminadas cuando el Distribuidor elimina la conexión SSO." },
      ],
    },
    {
      number: "8",
      title: "Sus Derechos de Privacidad",
      content: [
        { number: "8.1", text: "Derechos Disponibles para Todos los Usuarios. Derecho de Acceso: puede solicitar una copia de la información personal que tenemos sobre usted. Derecho de Corrección: puede solicitar la corrección de información personal inexacta o incompleta. Derecho de Eliminación: puede solicitar la eliminación de su cuenta y los datos personales asociados. Derecho a la Portabilidad de Datos: puede solicitar una exportación de sus datos en un formato estructurado, comúnmente utilizado y legible por máquina. Derecho a Retirar el Consentimiento: donde el procesamiento se basa en el consentimiento, puede retirar ese consentimiento en cualquier momento." },
        { number: "8.2", text: "Derechos Adicionales para Residentes de California (CCPA/CPRA). Derecho a Saber, Derecho a Eliminar, Derecho a Optar por No Participar en la Venta (no vendemos información personal), Derecho a la No Discriminación, Derecho a Corregir y Derecho a Limitar el Uso de Información Personal Sensible." },
        { number: "8.3", text: "Cómo Ejercer sus Derechos. Envíenos un correo electrónico a privacy@mergetasks.com. Incluya su nombre completo, la dirección de correo electrónico asociada con su cuenta y una descripción de su solicitud. Responderemos dentro de los 30 días para solicitudes de PIPEDA o GDPR, y dentro de los 45 días calendario para solicitudes de CCPA/CPRA." },
      ],
    },
    {
      number: "9",
      title: "Cookies y Tecnologías de Seguimiento",
      content: [
        { number: "9.1", text: "Cookies Esenciales. La Plataforma utiliza las siguientes cookies esenciales: tokens de sesión (cookies httpOnly, seguras, SameSite que autentican su sesión) y tokens CSRF (cookies de doble envío que protegen contra ataques de falsificación de solicitudes entre sitios). Estas cookies no pueden deshabilitarse sin interrumpir la funcionalidad principal de la Plataforma." },
        { number: "9.2", text: "Lo que No Usamos. No utilizamos cookies publicitarias ni píxeles de retargeting. No utilizamos servicios de análisis de terceros como Google Analytics o Facebook Pixel. No participamos en el seguimiento entre sitios." },
        { number: "9.3", text: "Análisis del Lado del Servidor. Recopilamos análisis de uso solo del lado del servidor (frecuencia de inicio de sesión, uso de funcionalidades, tasas de error). Estos datos se utilizan para mejorar la Plataforma y no involucran cookies de seguimiento de terceros en su navegador." },
      ],
    },
    {
      number: "10",
      title: "Privacidad de los Menores",
      content: [
        { number: "10.1", text: "La Plataforma está diseñada para uso empresarial y no está dirigida a menores de 16 años. No recopilamos conscientemente información personal de menores de 16 años. Si creemos que un menor nos ha proporcionado información personal, tomaremos medidas inmediatas para eliminar esa información. Si cree que un menor nos ha proporcionado información personal, contáctenos en privacy@mergetasks.com." },
      ],
    },
    {
      number: "11",
      title: "Transferencias Internacionales de Datos",
      content: [
        { number: "11.1", text: "MergeTasks tiene su sede en Ontario, Canadá. La Plataforma está alojada en América del Norte, y su información personal puede ser procesada en Canadá y los Estados Unidos. Ciertos proveedores de servicios procesan datos en los Estados Unidos, incluidos Stripe (pagos), OpenAI (funcionalidades de IA) e Intuit/QuickBooks (sincronización contable). Mantenemos protecciones contractuales estándar con estos proveedores." },
        { number: "11.2", text: "Usuarios Fuera de América del Norte. Si accede a la Plataforma desde fuera de América del Norte, usted reconoce y consiente la transferencia de su información personal a Canadá y los Estados Unidos." },
      ],
    },
    {
      number: "12",
      title: "Cambios a Esta Política de Privacidad",
      content: [
        { number: "12.1", text: "Podemos actualizar esta Política de Privacidad de vez en cuando para reflejar cambios en nuestras prácticas, tecnología, requisitos legales u otras razones operativas. Si realizamos cambios materiales, proporcionaremos al menos 30 días de aviso previo por correo electrónico o mediante una notificación prominente dentro de la aplicación antes de que los cambios entren en vigor." },
      ],
    },
    {
      number: "13",
      title: "Contáctenos",
      content: [
        { number: "13.1", text: "Si tiene preguntas, inquietudes o solicitudes sobre esta Política de Privacidad o nuestras prácticas de datos, contáctenos: MergeTasks — Ontario, Canadá — Consultas de Privacidad: privacy@mergetasks.com — Soporte General: support@mergetasks.com — Última actualización: 8 de abril de 2026." },
      ],
    },
  ],
};
