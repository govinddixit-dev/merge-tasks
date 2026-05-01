-- Migration 0031: Store SSO Identity Providers
-- Adds enterprise SSO support (SAML 2.0 + OpenID Connect) for store users.

-- New table: stores each IdP configuration per store
CREATE TABLE IF NOT EXISTS storeIdentityProviders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  storeId INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  protocol ENUM('saml', 'oidc') NOT NULL,
  domain VARCHAR(255) NOT NULL,
  -- SAML fields
  samlEntryPoint TEXT,
  samlCertificate TEXT,
  samlIssuer VARCHAR(512),
  -- OIDC fields
  oidcDiscoveryUrl TEXT,
  oidcClientId VARCHAR(255),
  oidcClientSecret TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sip_storeId FOREIGN KEY (storeId)
    REFERENCES stores(id) ON DELETE CASCADE,
  UNIQUE KEY uq_store_domain (storeId, domain)
);

-- Add SSO columns to storeUsers
ALTER TABLE storeUsers
  ADD COLUMN `ssoProviderId` INT NULL,
  ADD COLUMN ssoSubject VARCHAR(255) NULL,
  ADD CONSTRAINT fk_su_ssoProviderId
    FOREIGN KEY (ssoProviderId)
    REFERENCES storeIdentityProviders(id) ON DELETE SET NULL;
