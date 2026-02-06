-- Migration 076: Add high-value sender patterns
-- Cross-validated against actual database distribution (85%+ accuracy threshold)
-- Total new matches: ~672 records that will skip expensive AI classification

INSERT INTO detection_patterns (carrier_id, pattern_type, document_type, pattern, priority, confidence_base, notes, source)
VALUES
-- hlag.cloud → shipping_instructions (71 records, 97.2% accuracy)
('hapag-lloyd', 'sender', 'shipping_instructions', '@hlag\.cloud$', 80, 92, 'Hapag-Lloyd cloud portal - 97.2% SI documents', 'audit_076'),
-- substack.com → general_correspondence (163 records, 100% accuracy)
('generic', 'sender', 'general_correspondence', '@substack\.com$', 70, 95, 'Substack newsletters - 100% general correspondence', 'audit_076'),
-- email.meetup.com → general_correspondence (136 records, 92.6% accuracy)
('generic', 'sender', 'general_correspondence', '@email\.meetup\.com$', 70, 90, 'Meetup notifications - 92.6% general correspondence', 'audit_076'),
-- wtcalliance.com → general_correspondence (63 records, 96.8% accuracy)
('generic', 'sender', 'general_correspondence', '@wtcalliance\.com$', 70, 93, 'WTC Alliance newsletters - 96.8% general correspondence', 'audit_076'),
-- news.pitchbook.com → general_correspondence (60 records, 100% accuracy)
('generic', 'sender', 'general_correspondence', '@news\.pitchbook\.com$', 70, 95, 'PitchBook newsletters - 100% general correspondence', 'audit_076'),
-- scimplify.com → rate_request (56 records, 100% accuracy)
('generic', 'sender', 'rate_request', '@scimplify\.com$', 80, 95, 'Scimplify rate management - 100% rate requests', 'audit_076'),
-- email.mckinsey.com → general_correspondence (52 records, 98.1% accuracy)
('generic', 'sender', 'general_correspondence', '@email\.mckinsey\.com$', 70, 95, 'McKinsey newsletters - 98.1% general correspondence', 'audit_076'),
-- unftl.com → general_correspondence (71 records, 88.7% accuracy)
('generic', 'sender', 'general_correspondence', '@unftl\.com$', 70, 85, 'UNFTL freight association - 88.7% general correspondence', 'audit_076')
ON CONFLICT DO NOTHING;
