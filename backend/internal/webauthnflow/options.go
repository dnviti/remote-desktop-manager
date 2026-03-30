package webauthnflow

type CredentialDescriptor struct {
	ID         string   `json:"id"`
	Type       string   `json:"type"`
	Transports []string `json:"transports"`
}

type credentialParameter struct {
	Alg  int    `json:"alg"`
	Type string `json:"type"`
}

type registrationUser struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
}

type relyingParty struct {
	Name string `json:"name"`
	ID   string `json:"id"`
}

type authenticatorSelection struct {
	ResidentKey        string `json:"residentKey"`
	UserVerification   string `json:"userVerification"`
	RequireResidentKey bool   `json:"requireResidentKey"`
}

type registrationExtensions struct {
	CredProps bool `json:"credProps"`
}

type RegistrationOptions struct {
	Challenge              string                 `json:"challenge"`
	RP                     relyingParty           `json:"rp"`
	User                   registrationUser       `json:"user"`
	PubKeyCredParams       []credentialParameter  `json:"pubKeyCredParams"`
	Timeout                int                    `json:"timeout"`
	Attestation            string                 `json:"attestation"`
	ExcludeCredentials     []CredentialDescriptor `json:"excludeCredentials"`
	AuthenticatorSelection authenticatorSelection `json:"authenticatorSelection"`
	Extensions             registrationExtensions `json:"extensions"`
	Hints                  []string               `json:"hints"`
}

type AuthenticationOptions struct {
	Challenge        string                 `json:"challenge"`
	Timeout          int                    `json:"timeout"`
	RPID             string                 `json:"rpId"`
	AllowCredentials []CredentialDescriptor `json:"allowCredentials"`
	UserVerification string                 `json:"userVerification"`
	Hints            []string               `json:"hints"`
}

func (s Service) BuildRegistrationOptions(userName, displayName string, exclude []CredentialDescriptor) (RegistrationOptions, error) {
	challenge, err := s.NewChallenge()
	if err != nil {
		return RegistrationOptions{}, err
	}
	userHandle, err := s.NewUserHandle()
	if err != nil {
		return RegistrationOptions{}, err
	}
	return RegistrationOptions{
		Challenge: challenge,
		RP: relyingParty{
			Name: s.RPName,
			ID:   s.RPID,
		},
		User: registrationUser{
			ID:          userHandle,
			Name:        userName,
			DisplayName: displayName,
		},
		PubKeyCredParams: []credentialParameter{
			{Alg: -8, Type: "public-key"},
			{Alg: -7, Type: "public-key"},
			{Alg: -257, Type: "public-key"},
		},
		Timeout:            ChallengeTTLSeconds * 1000,
		Attestation:        "none",
		ExcludeCredentials: normalizeDescriptors(exclude),
		AuthenticatorSelection: authenticatorSelection{
			ResidentKey:        "preferred",
			UserVerification:   "preferred",
			RequireResidentKey: false,
		},
		Extensions: registrationExtensions{CredProps: true},
		Hints:      []string{},
	}, nil
}

func (s Service) BuildAuthenticationOptions(allow []CredentialDescriptor) (AuthenticationOptions, error) {
	challenge, err := s.NewChallenge()
	if err != nil {
		return AuthenticationOptions{}, err
	}
	return AuthenticationOptions{
		Challenge:        challenge,
		Timeout:          ChallengeTTLSeconds * 1000,
		RPID:             s.RPID,
		AllowCredentials: normalizeDescriptors(allow),
		UserVerification: "preferred",
		Hints:            []string{},
	}, nil
}

func normalizeDescriptors(items []CredentialDescriptor) []CredentialDescriptor {
	if len(items) == 0 {
		return []CredentialDescriptor{}
	}
	result := make([]CredentialDescriptor, 0, len(items))
	for _, item := range items {
		copyItem := item
		copyItem.Type = "public-key"
		if copyItem.Transports == nil {
			copyItem.Transports = []string{}
		}
		result = append(result, copyItem)
	}
	return result
}
