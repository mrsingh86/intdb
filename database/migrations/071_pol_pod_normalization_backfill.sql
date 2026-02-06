-- Migration 071: Normalize POL/POD raw city names to UN/LOCODE
-- ~11,400 records have raw city names instead of standardized UN/LOCODE
-- This backfill applies the same normalizations as PORT_NORMALIZATIONS in code

-- Indian Ports
UPDATE chronicle SET pol_location = 'INNSA' WHERE lower(pol_location) IN ('nhava sheva', 'jawaharlal nehru', 'jnpt', 'mumbai port');
UPDATE chronicle SET pod_location = 'INNSA' WHERE lower(pod_location) IN ('nhava sheva', 'jawaharlal nehru', 'jnpt', 'mumbai port');
UPDATE chronicle SET pol_location = 'INMUN' WHERE lower(pol_location) = 'mundra';
UPDATE chronicle SET pod_location = 'INMUN' WHERE lower(pod_location) = 'mundra';
UPDATE chronicle SET pol_location = 'INMAA' WHERE lower(pol_location) = 'chennai';
UPDATE chronicle SET pod_location = 'INMAA' WHERE lower(pod_location) = 'chennai';
UPDATE chronicle SET pol_location = 'INCCU' WHERE lower(pol_location) = 'kolkata';
UPDATE chronicle SET pod_location = 'INCCU' WHERE lower(pod_location) = 'kolkata';
UPDATE chronicle SET pol_location = 'INTUT' WHERE lower(pol_location) = 'tuticorin';
UPDATE chronicle SET pod_location = 'INTUT' WHERE lower(pod_location) = 'tuticorin';
UPDATE chronicle SET pol_location = 'INCOK' WHERE lower(pol_location) = 'cochin';
UPDATE chronicle SET pod_location = 'INCOK' WHERE lower(pod_location) = 'cochin';
UPDATE chronicle SET pol_location = 'INPAV' WHERE lower(pol_location) = 'pipavav';
UPDATE chronicle SET pod_location = 'INPAV' WHERE lower(pod_location) = 'pipavav';
UPDATE chronicle SET pol_location = 'INHZA' WHERE lower(pol_location) = 'hazira';
UPDATE chronicle SET pod_location = 'INHZA' WHERE lower(pod_location) = 'hazira';

-- US Ports
UPDATE chronicle SET pol_location = 'USNYC' WHERE lower(pol_location) IN ('new york', 'newark', 'port newark', 'new york/newark', 'ny/nj');
UPDATE chronicle SET pod_location = 'USNYC' WHERE lower(pod_location) IN ('new york', 'newark', 'port newark', 'new york/newark', 'ny/nj');
UPDATE chronicle SET pol_location = 'USLAX' WHERE lower(pol_location) IN ('los angeles', 'la');
UPDATE chronicle SET pod_location = 'USLAX' WHERE lower(pod_location) IN ('los angeles', 'la');
UPDATE chronicle SET pol_location = 'USLGB' WHERE lower(pol_location) = 'long beach';
UPDATE chronicle SET pod_location = 'USLGB' WHERE lower(pod_location) = 'long beach';
UPDATE chronicle SET pol_location = 'USCHI' WHERE lower(pol_location) = 'chicago';
UPDATE chronicle SET pod_location = 'USCHI' WHERE lower(pod_location) = 'chicago';
UPDATE chronicle SET pol_location = 'USHOU' WHERE lower(pol_location) = 'houston';
UPDATE chronicle SET pod_location = 'USHOU' WHERE lower(pod_location) = 'houston';
UPDATE chronicle SET pol_location = 'USSAV' WHERE lower(pol_location) = 'savannah';
UPDATE chronicle SET pod_location = 'USSAV' WHERE lower(pod_location) = 'savannah';
UPDATE chronicle SET pol_location = 'USBAL' WHERE lower(pol_location) = 'baltimore';
UPDATE chronicle SET pod_location = 'USBAL' WHERE lower(pod_location) = 'baltimore';
UPDATE chronicle SET pol_location = 'USSEA' WHERE lower(pol_location) IN ('seattle', 'tacoma');
UPDATE chronicle SET pod_location = 'USSEA' WHERE lower(pod_location) IN ('seattle', 'tacoma');
UPDATE chronicle SET pol_location = 'USOAK' WHERE lower(pol_location) = 'oakland';
UPDATE chronicle SET pod_location = 'USOAK' WHERE lower(pod_location) = 'oakland';
UPDATE chronicle SET pol_location = 'USORF' WHERE lower(pol_location) = 'norfolk';
UPDATE chronicle SET pod_location = 'USORF' WHERE lower(pod_location) = 'norfolk';
UPDATE chronicle SET pol_location = 'USCHS' WHERE lower(pol_location) = 'charleston';
UPDATE chronicle SET pod_location = 'USCHS' WHERE lower(pod_location) = 'charleston';
UPDATE chronicle SET pol_location = 'USMIA' WHERE lower(pol_location) = 'miami';
UPDATE chronicle SET pod_location = 'USMIA' WHERE lower(pod_location) = 'miami';
UPDATE chronicle SET pol_location = 'USJAX' WHERE lower(pol_location) = 'jacksonville';
UPDATE chronicle SET pod_location = 'USJAX' WHERE lower(pod_location) = 'jacksonville';
UPDATE chronicle SET pol_location = 'USPEF' WHERE lower(pol_location) = 'port everglades';
UPDATE chronicle SET pod_location = 'USPEF' WHERE lower(pod_location) = 'port everglades';

-- Chinese Ports
UPDATE chronicle SET pol_location = 'CNSHA' WHERE lower(pol_location) = 'shanghai';
UPDATE chronicle SET pod_location = 'CNSHA' WHERE lower(pod_location) = 'shanghai';
UPDATE chronicle SET pol_location = 'CNSZX' WHERE lower(pol_location) = 'shenzhen';
UPDATE chronicle SET pod_location = 'CNSZX' WHERE lower(pod_location) = 'shenzhen';
UPDATE chronicle SET pol_location = 'CNNGB' WHERE lower(pol_location) = 'ningbo';
UPDATE chronicle SET pod_location = 'CNNGB' WHERE lower(pod_location) = 'ningbo';
UPDATE chronicle SET pol_location = 'CNTAO' WHERE lower(pol_location) = 'qingdao';
UPDATE chronicle SET pod_location = 'CNTAO' WHERE lower(pod_location) = 'qingdao';
UPDATE chronicle SET pol_location = 'HKHKG' WHERE lower(pol_location) = 'hong kong';
UPDATE chronicle SET pod_location = 'HKHKG' WHERE lower(pod_location) = 'hong kong';
UPDATE chronicle SET pol_location = 'CNCAN' WHERE lower(pol_location) = 'guangzhou';
UPDATE chronicle SET pod_location = 'CNCAN' WHERE lower(pod_location) = 'guangzhou';
UPDATE chronicle SET pol_location = 'CNXMN' WHERE lower(pol_location) = 'xiamen';
UPDATE chronicle SET pod_location = 'CNXMN' WHERE lower(pod_location) = 'xiamen';
UPDATE chronicle SET pol_location = 'CNTSN' WHERE lower(pol_location) = 'tianjin';
UPDATE chronicle SET pod_location = 'CNTSN' WHERE lower(pod_location) = 'tianjin';
UPDATE chronicle SET pol_location = 'CNDLC' WHERE lower(pol_location) = 'dalian';
UPDATE chronicle SET pod_location = 'CNDLC' WHERE lower(pod_location) = 'dalian';

-- Southeast Asia
UPDATE chronicle SET pol_location = 'SGSIN' WHERE lower(pol_location) = 'singapore';
UPDATE chronicle SET pod_location = 'SGSIN' WHERE lower(pod_location) = 'singapore';
UPDATE chronicle SET pol_location = 'MYPKG' WHERE lower(pol_location) = 'port klang';
UPDATE chronicle SET pod_location = 'MYPKG' WHERE lower(pod_location) = 'port klang';
UPDATE chronicle SET pol_location = 'MYTPP' WHERE lower(pol_location) = 'tanjung pelepas';
UPDATE chronicle SET pod_location = 'MYTPP' WHERE lower(pod_location) = 'tanjung pelepas';
UPDATE chronicle SET pol_location = 'THLCH' WHERE lower(pol_location) = 'laem chabang';
UPDATE chronicle SET pod_location = 'THLCH' WHERE lower(pod_location) = 'laem chabang';
UPDATE chronicle SET pol_location = 'VNSGN' WHERE lower(pol_location) IN ('ho chi minh', 'cat lai');
UPDATE chronicle SET pod_location = 'VNSGN' WHERE lower(pod_location) IN ('ho chi minh', 'cat lai');
UPDATE chronicle SET pol_location = 'VNHPH' WHERE lower(pol_location) = 'hai phong';
UPDATE chronicle SET pod_location = 'VNHPH' WHERE lower(pod_location) = 'hai phong';
UPDATE chronicle SET pol_location = 'IDJKT' WHERE lower(pol_location) IN ('jakarta', 'tanjung priok');
UPDATE chronicle SET pod_location = 'IDJKT' WHERE lower(pod_location) IN ('jakarta', 'tanjung priok');

-- European Ports
UPDATE chronicle SET pol_location = 'NLRTM' WHERE lower(pol_location) = 'rotterdam';
UPDATE chronicle SET pod_location = 'NLRTM' WHERE lower(pod_location) = 'rotterdam';
UPDATE chronicle SET pol_location = 'DEHAM' WHERE lower(pol_location) = 'hamburg';
UPDATE chronicle SET pod_location = 'DEHAM' WHERE lower(pod_location) = 'hamburg';
UPDATE chronicle SET pol_location = 'BEANR' WHERE lower(pol_location) = 'antwerp';
UPDATE chronicle SET pod_location = 'BEANR' WHERE lower(pod_location) = 'antwerp';
UPDATE chronicle SET pol_location = 'GBFXT' WHERE lower(pol_location) = 'felixstowe';
UPDATE chronicle SET pod_location = 'GBFXT' WHERE lower(pod_location) = 'felixstowe';
UPDATE chronicle SET pol_location = 'GBSOU' WHERE lower(pol_location) = 'southampton';
UPDATE chronicle SET pod_location = 'GBSOU' WHERE lower(pod_location) = 'southampton';
UPDATE chronicle SET pol_location = 'FRLEH' WHERE lower(pol_location) = 'le havre';
UPDATE chronicle SET pod_location = 'FRLEH' WHERE lower(pod_location) = 'le havre';

-- Middle East
UPDATE chronicle SET pol_location = 'AEJEA' WHERE lower(pol_location) IN ('jebel ali', 'dubai');
UPDATE chronicle SET pod_location = 'AEJEA' WHERE lower(pod_location) IN ('jebel ali', 'dubai');
UPDATE chronicle SET pol_location = 'AEAUH' WHERE lower(pol_location) = 'abu dhabi';
UPDATE chronicle SET pod_location = 'AEAUH' WHERE lower(pod_location) = 'abu dhabi';
UPDATE chronicle SET pol_location = 'SAJED' WHERE lower(pol_location) = 'jeddah';
UPDATE chronicle SET pod_location = 'SAJED' WHERE lower(pod_location) = 'jeddah';

-- Other major ports
UPDATE chronicle SET pol_location = 'LKCMB' WHERE lower(pol_location) = 'colombo';
UPDATE chronicle SET pod_location = 'LKCMB' WHERE lower(pod_location) = 'colombo';
UPDATE chronicle SET pol_location = 'KRPUS' WHERE lower(pol_location) = 'busan';
UPDATE chronicle SET pod_location = 'KRPUS' WHERE lower(pod_location) = 'busan';
UPDATE chronicle SET pol_location = 'TWKHH' WHERE lower(pol_location) = 'kaohsiung';
UPDATE chronicle SET pod_location = 'TWKHH' WHERE lower(pod_location) = 'kaohsiung';

-- Canadian Ports
UPDATE chronicle SET pol_location = 'CAVAN' WHERE lower(pol_location) = 'vancouver';
UPDATE chronicle SET pod_location = 'CAVAN' WHERE lower(pod_location) = 'vancouver';
UPDATE chronicle SET pol_location = 'CAMTR' WHERE lower(pol_location) = 'montreal';
UPDATE chronicle SET pod_location = 'CAMTR' WHERE lower(pod_location) = 'montreal';
UPDATE chronicle SET pol_location = 'CATOR' WHERE lower(pol_location) = 'toronto';
UPDATE chronicle SET pod_location = 'CATOR' WHERE lower(pod_location) = 'toronto';
UPDATE chronicle SET pol_location = 'CAHAL' WHERE lower(pol_location) = 'halifax';
UPDATE chronicle SET pod_location = 'CAHAL' WHERE lower(pod_location) = 'halifax';
UPDATE chronicle SET pol_location = 'CAPRR' WHERE lower(pol_location) = 'prince rupert';
UPDATE chronicle SET pod_location = 'CAPRR' WHERE lower(pod_location) = 'prince rupert';

-- Also normalize "City, Country" format (e.g., "Nhava Sheva, India")
UPDATE chronicle SET pol_location = 'INNSA' WHERE lower(pol_location) LIKE 'nhava sheva%' AND pol_location !~ '^[A-Z]{5}$';
UPDATE chronicle SET pod_location = 'INNSA' WHERE lower(pod_location) LIKE 'nhava sheva%' AND pod_location !~ '^[A-Z]{5}$';
UPDATE chronicle SET pol_location = 'INNSA' WHERE lower(pol_location) LIKE 'jnpt%' AND pol_location !~ '^[A-Z]{5}$';
UPDATE chronicle SET pod_location = 'INNSA' WHERE lower(pod_location) LIKE 'jnpt%' AND pod_location !~ '^[A-Z]{5}$';
