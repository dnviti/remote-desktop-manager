import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant } from '../middleware/tenant.middleware';
import { requireTeamMember, requireTeamRole } from '../middleware/team.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { createTeamSchema, updateTeamSchema, addMemberSchema, updateMemberRoleSchema } from '../schemas/team.schemas';
import * as teamController from '../controllers/team.controller';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

// Team CRUD
router.post('/', validate(createTeamSchema), teamController.createTeam);
router.get('/', teamController.listTeams);
router.get('/:id', validateUuidParam(), requireTeamMember, teamController.getTeam);
router.put('/:id', validateUuidParam(), requireTeamMember, requireTeamRole('TEAM_ADMIN'), validate(updateTeamSchema), teamController.updateTeam);
router.delete('/:id', validateUuidParam(), requireTeamMember, requireTeamRole('TEAM_ADMIN', { allowTenantAdmin: true }), teamController.deleteTeam);

// Member management
router.get('/:id/members', validateUuidParam(), requireTeamMember, teamController.listMembers);
router.post('/:id/members', validateUuidParam(), requireTeamMember, requireTeamRole('TEAM_ADMIN'), validate(addMemberSchema), teamController.addMember);
router.put('/:id/members/:userId', validateUuidParam(), requireTeamMember, requireTeamRole('TEAM_ADMIN'), validateUuidParam('userId'), validate(updateMemberRoleSchema), teamController.updateMemberRole);
router.delete('/:id/members/:userId', validateUuidParam(), requireTeamMember, requireTeamRole('TEAM_ADMIN', { allowTenantAdmin: true }), validateUuidParam('userId'), teamController.removeMember);

export default router;
