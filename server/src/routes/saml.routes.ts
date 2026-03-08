import { Router } from 'express';
import express from 'express';
import * as samlController from '../controllers/saml.controller';

const router = Router();

// SP metadata (public)
router.get('/metadata', samlController.getMetadata);

// Initiate SAML login (public)
router.get('/', samlController.initiateSaml);

// Initiate SAML account linking (uses JWT from query param)
router.get('/link', samlController.initiateSamlLink);

// SAML ACS callback (POST with URL-encoded body from IdP)
router.post(
  '/callback',
  express.urlencoded({ extended: false }),
  samlController.handleSamlCallback,
);

export default router;
