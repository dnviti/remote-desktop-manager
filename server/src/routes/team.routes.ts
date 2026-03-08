import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant } from '../middleware/tenant.middleware';
import { requireTeamMember, requireTeamRole } from '../middleware/team.middleware';
import * as teamController from '../controllers/team.controller';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

// Team CRUD
router.post('/', teamController.createTeam);
router.get('/', teamController.listTeams);
router.get('/:id', requireTeamMember, teamController.getTeam);
router.put('/:id', requireTeamMember, requireTeamRole('TEAM_ADMIN'), teamController.updateTeam);
router.delete('/:id', requireTeamMember, requireTeamRole('TEAM_ADMIN', { allowTenantAdmin: true }), teamController.deleteTeam);

// Member management
router.get('/:id/members', requireTeamMember, teamController.listMembers);
router.post('/:id/members', requireTeamMember, requireTeamRole('TEAM_ADMIN'), teamController.addMember);
router.put('/:id/members/:userId', requireTeamMember, requireTeamRole('TEAM_ADMIN'), teamController.updateMemberRole);
router.delete('/:id/members/:userId', requireTeamMember, requireTeamRole('TEAM_ADMIN', { allowTenantAdmin: true }), teamController.removeMember);

export default router;
