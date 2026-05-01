// content/privacy-fr.ts
// Source of truth: MergeTasks_Politique_Confidentialite_FR.pdf — Date d'entrée en vigueur : 8 avril 2026

export const privacyFR = {
  title: "Politique de confidentialité",
  subtitle: "Plateforme MergeTasks",
  effectiveDate: "Date d'entrée en vigueur : 8 avril 2026",
  summaryBox: {
    heading: "La confidentialité en bref",
    points: [
      "Nous ne recueillons que ce dont nous avons besoin pour fournir la plateforme MergeTasks.",
      "Nous chiffrons vos données sensibles à l'aide du chiffrement AES-256-GCM conforme aux normes de l'industrie.",
      "Nous ne vendons jamais vos renseignements personnels — à personne, pour quelque raison que ce soit.",
      "Vous êtes propriétaire de vos données. Vous pouvez les exporter ou les supprimer à tout moment.",
      "Lorsque nous traitons des données pour le compte des Distributeurs, nous agissons strictement en tant que sous-traitant selon leurs instructions.",
    ],
  },
  intro: "MergeTasks (« MergeTasks », « nous », « notre » ou « nos ») est une société canadienne dont le siège social est en Ontario, Canada. Nous exploitons une plateforme logicielle en tant que service (SaaS) conçue pour les distributeurs de produits promotionnels en Amérique du Nord. La présente Politique de confidentialité décrit la façon dont nous recueillons, utilisons, divulguons et protégeons les renseignements personnels lorsque vous utilisez notre plateforme, notre site Web et les services connexes (collectivement, la « Plateforme »). Si vous avez des questions ou des préoccupations concernant la présente Politique de confidentialité ou nos pratiques en matière de données, veuillez nous contacter à privacy@mergetasks.com.",
  sections: [
    {
      number: "1",
      title: "Renseignements que nous recueillons",
      content: [
        { number: "1.1", text: "Renseignements que vous fournissez directement — Renseignements de compte de Distributeur. Lorsqu'un Distributeur s'inscrit à la Plateforme, nous recueillons : nom complet et adresse courriel ; mot de passe (stocké uniquement sous forme de hachage bcrypt — nous ne stockons jamais les mots de passe en clair) ; nom de l'organisation, adresse postale et numéro de téléphone ; renseignements de facturation traités par Stripe ; identifiant de compte Stripe Connect ; identifiants SMTP chiffrés au repos avec AES-256-GCM." },
        { number: "1.2", text: "Renseignements recueillis automatiquement. Lorsque vous utilisez la Plateforme, nous recueillons automatiquement certains renseignements techniques et d'utilisation : horodatages de connexion et activité de session ; habitudes d'utilisation des fonctionnalités et historique d'interaction avec le copilote IA ; renseignements sur l'appareil, le type de navigateur et le système d'exploitation ; adresse IP et emplacement géographique approximatif ; données d'erreur et de performance (recueillies par Sentry)." },
        { number: "1.3", text: "Renseignements provenant de services tiers. Nous recevons des renseignements limités des services tiers suivants lorsqu'autorisé par l'utilisateur : Stripe (identifiants de transaction, statut d'abonnement) ; QuickBooks Online (dossiers clients, factures, paiements — uniquement avec autorisation OAuth 2.0 explicite) ; Fournisseurs d'identité SSO (adresse courriel, nom, attributs de service et de rôle — MergeTasks ne reçoit ni ne stocke le mot de passe du fournisseur d'identité) ; OpenAI (requêtes et réponses du copilote IA — contexte produit/affaires uniquement)." },
        { number: "1.4", text: "Renseignements que nous traitons pour le compte des Distributeurs. Lorsque les Distributeurs utilisent la Plateforme pour gérer leurs activités, nous traitons certaines données en leur nom. Dans ce contexte, le Distributeur est le responsable du traitement et MergeTasks agit en tant que sous-traitant. Ces données comprennent : nom de l'entreprise cliente, coordonnées ; historique des propositions et des commandes ; données de facturation ; limites de dépenses et soldes de points des utilisateurs finaux ; historique des commandes des utilisateurs finaux ; renseignements d'identité SSO." },
      ],
    },
    {
      number: "2",
      title: "Utilisation de vos renseignements",
      content: [
        { number: "2.1", text: "Fourniture et exploitation de la Plateforme. Pour créer et maintenir votre compte, fournir les fonctionnalités et services demandés et administrer les boutiques en ligne exploitées par les Distributeurs." },
        { number: "2.2", text: "Traitement des paiements. Pour traiter les paiements d'abonnement et faciliter les transactions entre les Distributeurs et leurs utilisateurs finaux via Stripe." },
        { number: "2.3", text: "Synchronisation des données comptables. Pour synchroniser les données clients, factures, estimations et paiements entre MergeTasks et le compte QuickBooks Online d'un Distributeur, selon les instructions et l'autorisation du Distributeur." },
        { number: "2.4", text: "Authentification des utilisateurs. Pour vérifier votre identité via courriel/code à usage unique, authentification par mot de passe ou SSO via le fournisseur d'identité de votre organisation." },
        { number: "2.5", text: "Communications transactionnelles. Pour envoyer des confirmations de commande, des codes à usage unique, des notifications de remboursement et d'autres messages liés aux services." },
        { number: "2.6", text: "Amélioration de la Plateforme. Pour analyser les habitudes d'utilisation, surveiller les erreurs (via Sentry) et améliorer la fiabilité, les performances et les fonctionnalités de la Plateforme." },
        { number: "2.7", text: "Fonctionnalités alimentées par l'IA. Pour générer des suggestions de contenu, des épreuves virtuelles de produits et des recommandations d'optimisation de boutique à l'aide d'OpenAI. Ces fonctionnalités traitent le contexte des produits et des activités commerciales — les données personnelles ne sont pas intentionnellement incluses dans les requêtes IA." },
        { number: "2.8", text: "Sécurité et prévention des abus. Pour faire respecter nos Conditions d'utilisation, prévenir la fraude, détecter les accès non autorisés et protéger la sécurité de la Plateforme et de ses utilisateurs." },
        { number: "2.9", text: "Conformité légale. Pour nous conformer aux lois, réglementations, procédures judiciaires et demandes gouvernementales exécutoires applicables." },
      ],
    },
    {
      number: "3",
      title: "Communication de vos renseignements",
      content: [
        { number: "3.1", text: "Nous ne vendons pas les renseignements personnels. MergeTasks n'a jamais vendu de renseignements personnels et n'a pas l'intention de le faire. Cela s'applique à toutes les catégories de renseignements personnels que nous recueillons, pour tous les utilisateurs." },
        { number: "3.2", text: "Fournisseurs de services. Nous communiquons des renseignements personnels à des fournisseurs de services tiers de confiance qui effectuent des services en notre nom, sous réserve d'obligations contractuelles de protection de vos données : Stripe (traitement des paiements) ; OpenAI (fonctionnalités du copilote IA) ; Sentry (surveillance des erreurs) ; Fournisseurs SMTP (livraison des courriels transactionnels)." },
        { number: "3.3", text: "Selon les instructions du Distributeur. Lorsqu'un Distributeur autorise une intégration tierce, nous partageons les données selon ses instructions : QuickBooks Online (données clients, factures et paiements synchronisées bidirectionnellement) ; Fournisseurs d'identité SSO (demandes d'authentification et échange d'attributs selon la configuration du Distributeur)." },
        { number: "3.4", text: "Exigences légales. Nous pouvons divulguer des renseignements personnels si la loi l'exige, ou si nous croyons de bonne foi que cette action est nécessaire pour nous conformer à une obligation légale, protéger nos droits ou notre propriété, prévenir la fraude, ou répondre à une ordonnance judiciaire ou à une demande gouvernementale légale." },
        { number: "3.5", text: "Transferts d'entreprise. Dans le cadre d'une fusion, acquisition, réorganisation, vente d'actifs ou faillite, les renseignements personnels peuvent être transférés à l'entité acquéreuse. Nous vous informerons avant que vos renseignements personnels soient soumis à une politique de confidentialité différente." },
      ],
    },
    {
      number: "4",
      title: "Rôles en matière de traitement des données",
      content: [
        { number: "4.1", text: "MergeTasks en tant que responsable du traitement. MergeTasks agit en tant que responsable du traitement pour : les données d'inscription et de profil du compte Distributeur ; les données d'utilisation de la Plateforme et les analyses ; les informations de facturation et d'abonnement ; les communications entre MergeTasks et les Distributeurs." },
        { number: "4.2", text: "MergeTasks en tant que sous-traitant. MergeTasks agit en tant que sous-traitant pour : les données clients du Distributeur (informations sur l'entreprise, contacts, propositions, commandes, factures) ; les données des utilisateurs finaux dans les boutiques en ligne exploitées par les Distributeurs ; les données synchronisées avec QuickBooks Online selon les instructions du Distributeur ; les attributs d'identité SSO reçus du fournisseur d'identité configuré par le Distributeur." },
        { number: "4.3", text: "Responsabilités du Distributeur. Les Distributeurs, en tant que responsables du traitement des données de leurs clients et utilisateurs finaux, sont responsables de : obtenir tous les consentements nécessaires ou établir un fondement juridique valable pour le traitement ; fournir des avis de confidentialité appropriés à leurs clients et utilisateurs finaux ; répondre aux demandes d'accès des personnes concernées relatives aux données qu'ils contrôlent." },
        { number: "4.4", text: "Traitement des données QuickBooks. L'accès aux données QuickBooks Online d'un Distributeur nécessite l'autorisation OAuth 2.0 explicite du Distributeur. Les jetons d'accès et de rafraîchissement OAuth sont chiffrés avec AES-256-GCM au repos. Lors de la déconnexion, les mappages de synchronisation et les données QuickBooks mises en cache sont supprimés." },
      ],
    },
    {
      number: "5",
      title: "Services tiers et intégrations",
      content: [
        { number: "5.1", text: "Stripe. Stripe traite toutes les transactions de paiement sur la Plateforme. MergeTasks stocke les identifiants clients Stripe, les identifiants d'abonnement, les identifiants de compte Connect et les références de transaction — mais jamais les numéros de carte de crédit bruts, les CVV ou d'autres données de carte de paiement sensibles. Politique de confidentialité Stripe : https://stripe.com/privacy" },
        { number: "5.2", text: "QuickBooks Online (Intuit). L'intégration QuickBooks Online permet la synchronisation bidirectionnelle des données clients, factures, estimations et paiements. L'intégration nécessite l'autorisation OAuth 2.0 explicite du Distributeur. Les jetons OAuth sont chiffrés avec AES-256-GCM au repos et transmis via TLS 1.2+. Déclaration de confidentialité Intuit : https://www.intuit.com/privacy/" },
        { number: "5.3", text: "Fournisseurs d'identité SSO (Okta, Microsoft Azure AD, Google Workspace). Les Distributeurs peuvent configurer le SSO pour authentifier leurs utilisateurs finaux via SAML 2.0 ou OpenID Connect (OIDC). MergeTasks reçoit l'adresse courriel, le nom et, facultativement, les attributs de service et de rôle. MergeTasks ne reçoit, ne stocke ni n'a accès au mot de passe du fournisseur d'identité de l'utilisateur." },
        { number: "5.4", text: "OpenAI. OpenAI alimente les fonctionnalités du copilote IA de la Plateforme. Les requêtes envoyées à OpenAI contiennent des informations sur le catalogue de produits et le contexte commercial. Aucune donnée personnelle n'est intentionnellement incluse dans les requêtes. Politiques d'utilisation OpenAI : https://openai.com/policies/usage-policies" },
      ],
    },
    {
      number: "6",
      title: "Sécurité des données",
      content: [
        { number: "6.1", text: "Chiffrement. Au repos : les jetons OAuth, les identifiants SMTP et les secrets clients SSO sont chiffrés avec AES-256-GCM. En transit : toutes les données sont transmises via TLS 1.2 ou supérieur. Mots de passe : stockés sous forme de hachages bcrypt — jamais en clair. Codes à usage unique : hachés avec SHA-256 avant stockage." },
        { number: "6.2", text: "Contrôles d'accès. Contrôles d'accès basés sur les rôles avec isolation des données par organisation (multi-location). Verrouillage du compte après 10 tentatives de connexion consécutives infructueuses. Jetons de session de courte durée (jetons d'accès de 15 minutes, jetons de rafraîchissement de 7 jours) avec révocation côté serveur. Protection CSRF utilisant le modèle de double soumission de cookie." },
        { number: "6.3", text: "Surveillance et journalisation. Journalisation d'audit complète pour les événements d'authentification, les modifications de configuration de paiement, les exportations de données et les événements SSO. Surveillance des erreurs via Sentry pour l'identification et la correction rapides des problèmes." },
        { number: "6.4", text: "Notification de violation. En cas de violation de données affectant vos renseignements personnels, nous informerons les utilisateurs concernés et les autorités réglementaires applicables dans les 72 heures suivant la prise de connaissance de la violation, conformément aux exigences de la LPRPDE, de la CCPA/CPRA et du RGPD." },
      ],
    },
    {
      number: "7",
      title: "Conservation des données",
      content: [
        { number: "7.1", text: "Nous conservons les renseignements personnels uniquement aussi longtemps que nécessaire pour accomplir les fins décrites dans la présente Politique de confidentialité, ou tel que requis par la loi. Périodes de conservation : données de compte — période de compte actif + 90 jours après résiliation ; codes de vérification (OTP) — supprimés automatiquement après expiration ; jetons de rafraîchissement — supprimés automatiquement 7 jours après expiration ; journaux d'audit — minimum 90 jours ; mappages de synchronisation QuickBooks — supprimés lors de la déconnexion ; configurations de fournisseurs SSO — supprimées lors de la suppression de la connexion SSO." },
      ],
    },
    {
      number: "8",
      title: "Vos droits en matière de vie privée",
      content: [
        { number: "8.1", text: "Droits disponibles pour tous les utilisateurs. Droit d'accès : vous pouvez demander une copie des renseignements personnels que nous détenons à votre sujet. Droit de rectification : vous pouvez demander la correction de renseignements personnels inexacts ou incomplets. Droit à l'effacement : vous pouvez demander la suppression de votre compte et des données personnelles associées. Droit à la portabilité des données : vous pouvez demander une exportation de vos données dans un format structuré, couramment utilisé et lisible par machine. Droit de retirer votre consentement : lorsque le traitement est basé sur le consentement, vous pouvez retirer ce consentement à tout moment." },
        { number: "8.2", text: "Droits supplémentaires pour les utilisateurs canadiens (LPRPDE). En vertu de la Loi sur la protection des renseignements personnels et les documents électroniques (LPRPDE), vous avez le droit de savoir quels renseignements personnels nous détenons à votre sujet et comment ils sont utilisés ; de contester l'exactitude et l'exhaustivité de vos renseignements personnels ; de retirer votre consentement pour la collecte, l'utilisation ou la divulgation de vos renseignements personnels. Si vous n'êtes pas satisfait(e) de notre réponse, vous pouvez déposer une plainte auprès du Commissariat à la protection de la vie privée du Canada à www.priv.gc.ca." },
        { number: "8.3", text: "Comment exercer vos droits. Envoyez-nous un courriel à privacy@mergetasks.com. Incluez votre nom complet, l'adresse courriel associée à votre compte et une description de votre demande. Nous répondrons dans les 30 jours pour les demandes en vertu de la LPRPDE ou du RGPD, et dans les 45 jours civils pour les demandes en vertu de la CCPA/CPRA." },
      ],
    },
    {
      number: "9",
      title: "Témoins de connexion et technologies de suivi",
      content: [
        { number: "9.1", text: "Témoins essentiels. La Plateforme utilise les témoins essentiels suivants : jetons de session (témoins httpOnly, sécurisés, SameSite qui authentifient votre session) et jetons CSRF (témoins de double soumission qui protègent contre les attaques de falsification de requêtes intersites). Ces témoins ne peuvent pas être désactivés sans compromettre les fonctionnalités essentielles de la Plateforme." },
        { number: "9.2", text: "Ce que nous n'utilisons pas. Nous n'utilisons pas de témoins publicitaires ni de pixels de reciblage. Nous n'utilisons pas de services d'analyse tiers tels que Google Analytics ou Facebook Pixel. Nous ne nous livrons pas au suivi intersites." },
        { number: "9.3", text: "Analyses côté serveur. Nous recueillons des analyses d'utilisation uniquement côté serveur (fréquence de connexion, utilisation des fonctionnalités, taux d'erreur). Ces données sont utilisées pour améliorer la Plateforme et n'impliquent pas de témoins de suivi tiers dans votre navigateur." },
      ],
    },
    {
      number: "10",
      title: "Vie privée des enfants",
      content: [
        { number: "10.1", text: "La Plateforme est conçue pour un usage professionnel et ne s'adresse pas aux enfants de moins de 16 ans. Nous ne recueillons pas sciemment de renseignements personnels auprès d'enfants de moins de 16 ans. Si vous croyez qu'un enfant nous a fourni des renseignements personnels, veuillez nous contacter à privacy@mergetasks.com." },
      ],
    },
    {
      number: "11",
      title: "Transferts internationaux de données",
      content: [
        { number: "11.1", text: "MergeTasks a son siège social en Ontario, Canada. La Plateforme est hébergée en Amérique du Nord et vos renseignements personnels peuvent être traités au Canada et aux États-Unis. Certains fournisseurs de services traitent les données aux États-Unis, notamment Stripe (paiements), OpenAI (fonctionnalités IA) et Intuit/QuickBooks (synchronisation comptable). Nous maintenons des protections contractuelles standard avec ces fournisseurs." },
        { number: "11.2", text: "Utilisateurs canadiens. Les transferts de renseignements personnels aux États-Unis sont conformes au principe de responsabilité de la LPRPDE. MergeTasks demeure responsable de la protection de vos renseignements personnels, quel que soit l'endroit où ils sont traités." },
      ],
    },
    {
      number: "12",
      title: "Modifications à la présente politique de confidentialité",
      content: [
        { number: "12.1", text: "Nous pouvons mettre à jour la présente Politique de confidentialité de temps à autre pour refléter des changements dans nos pratiques, notre technologie, les exigences légales ou pour d'autres raisons opérationnelles. Si nous apportons des modifications importantes, nous fournirons un préavis d'au moins 30 jours par courriel ou par notification dans l'application avant l'entrée en vigueur des modifications." },
      ],
    },
    {
      number: "13",
      title: "Nous joindre",
      content: [
        { number: "13.1", text: "Si vous avez des questions, des préoccupations ou des demandes concernant la présente Politique de confidentialité ou nos pratiques en matière de données, veuillez nous contacter : MergeTasks — Ontario, Canada — Demandes de confidentialité : privacy@mergetasks.com — Assistance générale : support@mergetasks.com — Dernière mise à jour : 8 avril 2026." },
      ],
    },
  ],
};
