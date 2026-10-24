# AiSensy setup checklist — SIR Talent Hunt

Official reference checked: AiSensy Help Center, “API Reference Docs” and “How to create and automate the Authentication WhatsApp Template messages”.

- API campaign endpoint documented by AiSensy: `POST https://backend.aisensy.com/campaign/t1/api/v2`
- Requests require the private API campaign key and a campaign name that is set Live.
- The chosen WhatsApp template must be approved before it is used.
- Authentication templates are supported through an API campaign workflow according to AiSensy's documentation.
- Store the API key only as a Supabase Edge Function secret; never put it in HTML, source control, screenshots, or chat.
- Send the generated OTP as the template parameter and use the same code for the authentication template's copy-code/button parameter if the selected template requires it. Confirm exact payload in the user's AiSensy campaign's Test Campaign cURL before implementation.
- Do not assume the campaign name, template name, language, template parameters, or button configuration. These are account-specific and must be supplied from the live AiSensy dashboard.
- The Edge Function must generate and verify OTP on our server; AiSensy is the delivery channel. Never trust a browser-submitted “verified” flag.
- A successful HTTP response alone should not be treated as proof the user received or entered the OTP. Verify through the backend challenge record and test delivery end-to-end.

## User dashboard details needed before integration

1. Approved authentication template name and language.
2. Live API campaign name using that template.
3. From the campaign's Test Campaign screen, inspect the exact JSON/cURL structure and confirm whether OTP is expected in both templateParams and button parameters.
4. Confirm that WhatsApp Business API is active for the AiSensy project.

Never share the API key/token in screenshots or chat. If a cURL contains the key, redact the key before sharing; retain the endpoint, campaign name, parameter keys, and payload shape.
