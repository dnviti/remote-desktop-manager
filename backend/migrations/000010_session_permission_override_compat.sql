UPDATE public."TenantMember"
SET "permissionOverrides" =
	(("permissionOverrides" - 'canManageSessions')
		|| CASE
			WHEN "permissionOverrides" ? 'canViewSessions' THEN '{}'::jsonb
			ELSE jsonb_build_object('canViewSessions', ("permissionOverrides" ->> 'canManageSessions')::boolean)
		   END
		|| CASE
			WHEN "permissionOverrides" ? 'canObserveSessions' THEN '{}'::jsonb
			ELSE jsonb_build_object('canObserveSessions', ("permissionOverrides" ->> 'canManageSessions')::boolean)
		   END
		|| CASE
			WHEN "permissionOverrides" ? 'canControlSessions' THEN '{}'::jsonb
			ELSE jsonb_build_object('canControlSessions', ("permissionOverrides" ->> 'canManageSessions')::boolean)
		   END)
WHERE "permissionOverrides" IS NOT NULL
	AND "permissionOverrides" <> 'null'::jsonb
	AND "permissionOverrides" ? 'canManageSessions';
