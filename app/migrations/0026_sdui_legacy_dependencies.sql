-- Add dependency scripts to legacy SDUI fragments without blocking the page shell.

UPDATE ui_metadata
SET props_json = '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/feature.html","scripts":["/assets/stt-client.js"]}',
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'feature' AND node_id = 'feature.fragment';

UPDATE ui_metadata
SET props_json = '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/analysis.html","scripts":["https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js","https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js","/assets/stt-client.js"]}',
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'analysis' AND node_id = 'analysis.fragment';

UPDATE ui_metadata
SET props_json = '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/analysis-edit2.html","scripts":["https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js","https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js","/assets/stt-client.js"]}',
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'analysis-edit' AND node_id = 'analysisEdit.fragment';

UPDATE ui_metadata
SET props_json = '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/mypage.html","scripts":["https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"]}',
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'mypage' AND node_id = 'mypage.fragment';

UPDATE ui_metadata
SET props_json = '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/stats.html","scripts":["https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"]}',
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'stats' AND node_id = 'stats.fragment';
