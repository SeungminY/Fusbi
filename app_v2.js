/**
 * 3D 룸 플래너 애플리케이션 핵심 로직 (app.js)
 * 
 * [한국어 강제 원칙]
 * 본 프로그램은 사용자가 업로드한 아파트 49A형 단위세대 평면도를 해석하여
 * 현관, 침실2, 거실, 주방/식당, 발코니2, 욕실, 침실1, 발코니1, 실외기실을 3D로 구현합니다.
 * 천장 높이는 2300mm로 고정하고, 벽체 두께는 실측값을 입력받아 동적으로 계산합니다.
 * 
 * [피드백 반영 사항 - 침실2 실사 정밀 렌더링 구현]
 * 1. 침실2 실측 크기 반영 및 전체 도면 우측벽 역계산:
 *    - 사용자의 실측값(가로 270cm, 세로 345cm)을 침실2(`bedroom2`)에 적용했습니다.
 *    - 이에 맞추어 현관 세로 길이와 우측 끝 외벽선 위치(`X = 10050`)를 역계산하여 평면도 격자 전체를 보정했습니다.
 * 2. 침실2 세부 3D 실사 모사:
 *    - 라이트 화이트 오크 강마루 텍스처와 크림 화이트 벽지를 적용했습니다.
 *    - 창문 바로 위 천장 벽면에 흰색 시스템 에어컨 패널을 정밀하게 제작하여 매달았습니다.
 *    - 천장 중앙에 실제 사진의 심플 원형 LED 조명을 설치하고 주백색 포인트 광원을 부착했습니다.
 *    - 방문에 매트 블랙(무광 검정) 레버형 문손잡이를 L자 실린더 조립으로 디테일하게 추가했습니다.
 *    - 온도조절기(높이 112cm), 스위치, 배전반 커버 2종 및 하단 전기 콘센트 플레이트를 사진의 실물 배치 그대로 재현했습니다.
 */

// --- 글로벌 브라우저 런타임 에러 캐처 ---
window.onerror = function(message, source, lineno, colno, error) {
    alert("자바스크립트 런타임 오류 발생!\n\n메시지: " + message + "\n라인: " + lineno + "\n파일: " + source);
    return false;
};

// --- 글로벌 상태 및 변수 선언 ---
let scene, camera, renderer, controls;
let roomFloors = [];     // 개별 방 바닥 메쉬 배열
let roomWalls = [];      // 벽체 메쉬 배열
let furnitureList = [];   // 배치된 가구 오브젝트 배열
let selectedObject = null; // 현재 선택된 가구 객체
let dimensionsGroup;     // 2D 모드에서만 켜지는 3D 치수 가이드선 그룹
let detailObjects = [];  // 침실2 실사 디테일 메시들 배열 (초기화용)
let doorPivot = null;     // 침실2 방문 회전 피벗 그룹
let isDoorOpen = true;    // 방문 열림 상태 (기본값 true)
let bedroom2DimGroup = null; // 침실2 3D 실측 치수선 그룹
let isBedroom2DimVisible = false; // 침실2 실측 치수선 표시 토글 상태
const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

// 도면 전체 크기 (좌우 외벽 바깥면 기준 10520mm, 남북 외벽 바깥면 기준 12830mm)
const PLAN_WIDTH = 10520;
const PLAN_DEPTH = 12830;
const MM_TO_UNIT = 0.001; 
const UNIT_TO_MM = 1000;

// 벽체 가변 설정 (높이 2300mm 고정, 두께 기본 200mm)
let wallThickness = 200; // mm 단위
const WALL_HEIGHT = 2300; // mm 단위 (고정)

// 드래그 앤 드롭 조작을 위한 변수
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let isDragging = false;
let dragPlane = new THREE.Plane();
let dragOffset = new THREE.Vector3();
let intersectionPoint = new THREE.Vector3();

// 텍스처 및 로더
const textureLoader = new THREE.TextureLoader();
let floorTextures = {};
let wallTextures = {};

// 2D / 3D 뷰 모드
let is2DMode = false;

// --- 월드 좌표계 변환 상수 및 헬퍼 함수 ---
const offsetX = -PLAN_WIDTH * 0.5 * MM_TO_UNIT; // -5.26
const offsetZ = -PLAN_DEPTH * 0.5 * MM_TO_UNIT; // -6.415

// 도면 상 X -> 3D X
function getWorldX(x_mm) {
    return x_mm * MM_TO_UNIT + offsetX;
}

// 도면 상 Z -> 3D Z: 북측(-Z, 화면 위), 남측(+Z, 화면 아래)
function getWorldZ(z_mm) {
    return (PLAN_DEPTH * 0.5 - z_mm) * MM_TO_UNIT;
}

// --- 49A형 아파트 구역(방) 데이터 설계 (실측 안치수 100% 보존 및 정렬) ---
const ROOMS_DATA = [
    { id: 'utility', name: '실외기실', x: 200, z: 1135, w: 1630, d: 1650, floorPreset: 'dark' }, // Z: 2505 -> 1135
    { id: 'balcony1', name: '발코니1', x: 2030, z: 1135, w: 1500, d: 1650, floorPreset: 'tile' }, // Z: 2505 -> 1135
    { id: 'bedroom1', name: '침실1', x: 240, z: 2960, w: 3300, d: 2985, floorPreset: 'wood' }, // Z: 2960 ~ 5945 (안방 북벽 내면 5945 정렬)
    { id: 'dressroom', name: '드레스룸', x: 240, z: 6165, w: 2075, d: 1005, floorPreset: 'wood' }, // Z: 6165 ~ 7170 (가로 안치수 2075, 세로 안치수 1005 정밀 정합)
    { id: 'passage', name: '복도', x: 2535, z: 6165, w: 1005, d: 1005, floorPreset: 'wood' }, // Z: 6165 ~ 7170 (격벽 동향 이동 x: 2535, 폭 w: 1005, 깊이 d: 1005)
    { id: 'bath', name: '욕실', x: 1235, z: 7470, w: 2415, d: 1780, floorPreset: 'tile' }, // Z: 7470 ~ 9250 (도면 실측 1780 적용)
    { id: 'balcony2', name: '발코니2', x: 1235, z: 9060, w: 2415, d: 2110, floorPreset: 'tile' }, // Z: 9060 ~ 11170 (실측 가로 2415mm(PS 공간 포함), 세로 2110mm 정합 및 ㄱ자 가용공간 확보)
    { id: 'living', name: '거실', x: 3760, z: 2495, w: 3600, d: 3600, floorPreset: 'wood' }, // 고정
    { id: 'kitchen', name: '주방/식당', x: 2760, z: 6095, w: 4240, d: 4955, floorPreset: 'wood' }, // X: 2760 ~ 7000 (총 가로 4240), 바닥 강마루(wood) 전환
    { id: 'bedroom2', name: '침실2', x: 7580, z: 2495, w: 2700, d: 3450, floorPreset: 'bedroom2_wood' }, // 고정
    { id: 'entrance', name: '현관', x: 7580, z: 6165, w: 2700, d: 1290, floorPreset: 'tile' }, // 고정
    { id: 'kitchen_passage', name: '주방복도', x: 7000, z: 6055, w: 470, d: 1510, floorPreset: 'wood' } // 신설 복도 통로 바닥 추가
];

// --- 벽체 세그먼트 데이터 설계 (개별 벽 두께 적용 및 중심선 정합) ---
const WALL_SEGMENTS = [
    // 1. 가로 벽체들 (z1 == z2)
    { x1: 100, z1: 1015, x2: 3645, z2: 1015, thickness: 200, hasDoor: false }, // 실외기실/발코니1 남측 외벽 (Z = 1015)
    { x1: 3650, z1: 2385, x2: 4210, z2: 2385, thickness: 220, hasDoor: false }, // 거실 남서측 좌가벽 (창문 양옆 틈새 복구)
    { x1: 4210, z1: 2385, x2: 6910, z2: 2385, thickness: 220, hasWindow: true, winMinY: 290, winMaxY: 2290 }, // 거실 남측 창문 벽 (Z = 2385)
    { x1: 6910, z1: 2385, x2: 7470, z2: 2385, thickness: 220, hasDoor: false }, // 거실 남동측 우가벽 (창문 양옆 틈새 복구)
    { x1: 7470, z1: 2385, x2: 8280, z2: 2385, thickness: 220, hasDoor: false }, // 침실2 남측 가벽 (좌)
    { x1: 8280, z1: 2385, x2: 9980, z2: 2385, thickness: 220, hasWindow: true, winMinY: 1130, winMaxY: 2230 }, // 침실2 남측 창문 벽
    { x1: 9980, z1: 2385, x2: 10400, z2: 2385, thickness: 220, hasDoor: false }, // 침실2 남측 가벽 (우)
    { x1: 120, z1: 2872.5, x2: 3650, z2: 2872.5, thickness: 175, hasDoor: true, doorPos: 2400, doorWidth: 900 },
    { x1: 7470, z1: 6055, x2: 10400, z2: 6055, thickness: 220, hasDoor: true, doorPos: 7700, doorWidth: 900 }, // 현관 남측 가벽 (X=7470 복도 통로 확보)
    { x1: 120, z1: 6055, x2: 2425, z2: 6055, thickness: 220, hasDoor: true, doorPos: 780, doorWidth: 1000 },
    { x1: 2425, z1: 6055, x2: 3650, z2: 6055, thickness: 220, hasDoor: true, doorPos: 2540, doorWidth: 900 },
    { x1: 7000, z1: 7565, x2: 10400, z2: 7565, thickness: 220, hasDoor: true, doorPos: 8000, doorWidth: 1000 }, // 현관 북측 가벽 (세대 진입 현관문 배치 및 외벽 밀봉)
    { x1: 1235, z1: 7360, x2: 3650, z2: 7360, thickness: 220, hasDoor: true, doorPos: 2535, doorWidth: 900 },
    { x1: 1235, z1: 9060, x2: 3650, z2: 9060, thickness: 220, hasDoor: false }, // 욕실-발코니2 경계벽 실측 복원
    { x1: 120, z1: 11170, x2: 1835, z2: 11170, thickness: 240, hasDoor: false }, // 북측 외벽 분할1 (PS실 내부 및 좌측 외벽)
    { x1: 1835, z1: 11170, x2: 2065, z2: 11170, thickness: 240, hasDoor: false }, // 북측 외벽 분할2 (창문 좌측 여백 230mm)
    { x1: 2065, z1: 11170, x2: 2965, z2: 11170, thickness: 240, hasWindow: true, winMinY: 1150, winMaxY: 2250 }, // 북측 외벽 분할3 (창폭 900mm 샷시 설치용 - 뚫림 방지)
    { x1: 2965, z1: 11170, x2: 3650, z2: 11170, thickness: 240, hasDoor: false }, // 북측 외벽 분할4 (창문 우측 여백)
    { x1: 3650, z1: 11170, x2: 4150, z2: 11170, thickness: 240, hasDoor: false }, // 북측 외벽 분할5 (주방 영역)
    { x1: 4150, z1: 11170, x2: 5350, z2: 11170, thickness: 240, hasWindow: true, winMinY: 1000, winMaxY: 2200 },
    { x1: 5350, z1: 11170, x2: 7120, z2: 11170, thickness: 240, hasDoor: false },
    { x1: 120, z1: 1015, x2: 120, z2: 11170, thickness: 240, hasDoor: false },
    { x1: 1930, z1: 1015, x2: 1930, z2: 2872.5, thickness: 200, hasDoor: true, doorPos: 1230, doorWidth: 800 },
    { x1: 3650, z1: 7360, x2: 3650, z2: 9060, thickness: 220, hasDoor: false },
    { x1: 3650, z1: 9060, x2: 3650, z2: 11170, thickness: 220, hasDoor: true, doorPos: 9290, doorWidth: 900 }, // 주방-발코니2 경계 세로벽 실측 보정 (여백 23cm, 문폭 90cm, 남측고 9060)
    { x1: 1235, z1: 7360, x2: 1235, z2: 10470, thickness: 220, hasDoor: false }, // 욕실 및 세탁기 공간 서측 외벽
    { x1: 1235, z1: 10470, x2: 1235, z2: 11170, thickness: 220, hasDoor: false }, // PS실 내부 서측 외벽
    { x1: 1235, z1: 10470, x2: 1835, z2: 10470, thickness: 160, hasDoor: false }, // PS실 남측 가벽 복구 (ㄱ자 형태 구현)
    { x1: 1835, z1: 10470, x2: 1835, z2: 11170, thickness: 160, hasDoor: false }, // PS실 동측 가벽 복구 (ㄱ자 형태 구현)
    { x1: 3650, z1: 1015, x2: 3650, z2: 6055, thickness: 220, hasDoor: false, isArtwall: true },
    { x1: 2425, z1: 6055, x2: 2425, z2: 7360, thickness: 220, hasDoor: false },
    { x1: 7470, z1: 2385, x2: 7470, z2: 6055, thickness: 220, hasDoor: false }, // 거실-침실2 세로 격벽 X=7470 원복
    { x1: 7000, z1: 7580, x2: 7000, z2: 11170, thickness: 220, hasDoor: false }, // 주방 우측 가벽 (기둥 남측 끝선 Z=7580 정합 및 남는 단차 벽 제거)
    { x1: 10400, z1: 2385, x2: 10400, z2: 7565, thickness: 240, hasDoor: false }
];

// --- 외부 치수선 설계 데이터 (도면 마젠타 자홍색 치수선 완전 매치) ---
const DIMENSION_SEGMENTS = [
    { x1: 120, z1: 2185, x2: 3650, z2: 2185, label: '3,530 mm', textX: 1885, textZ: 2185, refX1: 120, refZ1: 2385, refX2: 3650, refZ2: 2385 },
    { x1: 3650, z1: 2185, x2: 7470, z2: 2185, label: '3,820 mm', textX: 5560, textZ: 2185, refX1: 3650, refZ1: 2385, refX2: 7470, refZ2: 2385 },
    { x1: 7470, z1: 2185, x2: 10400, z2: 2185, label: '2,930 mm', textX: 8935, textZ: 2185, refX1: 7470, refZ1: 2385, refX2: 10400, refZ2: 2385 },
    { x1: 120, z1: 1585, x2: 10400, z2: 1585, label: '10,280 mm', textX: 5260, textZ: 1585, refX1: 120, refZ1: 2385, refX2: 10400, refZ2: 2385 },
    
    // 3. 상단 가로 치수선들 (Z = 11770mm) - 도면 3분할 정합 (1115 / 2415 / 3630)
    { x1: 120, z1: 11770, x2: 1235, z2: 11770, label: '1,115 mm', textX: 677.5, textZ: 11770, refX1: 120, refZ1: 11170, refX2: 1235, refZ2: 11170 },
    { x1: 1235, z1: 11770, x2: 3650, z2: 11770, label: '2,415 mm', textX: 2442.5, textZ: 11770, refX1: 1235, refZ1: 11170, refX2: 3650, refZ2: 11170 },
    { x1: 3650, z1: 11770, x2: 7280, z2: 11770, label: '3,630 mm', textX: 5465, textZ: 11770, refX1: 3650, refZ1: 11170, refX2: 7280, refZ2: 11170 },

    { x1: -800, z1: 1015, x2: -800, z2: 2872.5, label: '1,650 mm', textX: -800, textZ: 1943.75, refX1: 120, refZ1: 1015, refX2: 120, refZ2: 2872.5 },
    { x1: -800, z1: 2872.5, x2: -800, z2: 6055, label: '3,235 mm', textX: -800, textZ: 4463.75, refX1: 120, refZ1: 2872.5, refX2: 120, refZ2: 6055 },
    { x1: -800, z1: 6055, x2: -800, z2: 7280, label: '1,225 mm', textX: -800, textZ: 6667.5, refX1: 120, refZ1: 6055, refX2: 120, refZ2: 7280 },
    { x1: -800, z1: 7280, x2: -800, z2: 9060, label: '1,780 mm', textX: -800, textZ: 8170, refX1: 120, refZ1: 7280, refX2: 120, refZ2: 9060 },
    { x1: -800, z1: 9060, x2: -800, z2: 9810, label: '750 mm', textX: -800, textZ: 9435, refX1: 120, refZ1: 9060, refX2: 120, refZ2: 9810 },
    { x1: -800, z1: 9810, x2: -800, z2: 11340, label: '1,360 mm', textX: -800, textZ: 10575, refX1: 120, refZ1: 9810, refX2: 120, refZ2: 11340 },
    // 좌측 전체 세로 치수선 (X = -1400mm)
    { x1: -1400, z1: 1015, x2: -1400, z2: 11340, label: '10,000 mm', textX: -1400, textZ: 6177.5, refX1: 120, refZ1: 1015, refX2: 120, refZ2: 11340 },
 
    // 4. 우측 외부 세로 치수선들 (X = 11200mm) - 도면 5분할 정합 (3765 / 1290 / 2460 / 1450 / 960)
    { x1: 11200, z1: 7455, x2: 11200, z2: 11220, label: '3,765 mm', textX: 11200, textZ: 9337.5, refX1: 10400, refZ1: 7455, refX2: 10400, refZ2: 11220 },
    { x1: 11200, z1: 6165, x2: 11200, z2: 7455, label: '1,290 mm', textX: 11200, textZ: 6810, refX1: 10400, refZ1: 6165, refX2: 10400, refZ2: 7455 },
    { x1: 11200, z1: 3705, x2: 11200, z2: 6165, label: '2,460 mm', textX: 11200, textZ: 4935, refX1: 10400, refZ1: 3705, refX2: 10400, refZ2: 6165 },
    { x1: 11200, z1: 2255, x2: 11200, z2: 3705, label: '1,450 mm', textX: 11200, textZ: 2980, refX1: 10400, refZ1: 2255, refX2: 10400, refZ2: 3705 },
    { x1: 11200, z1: 1295, x2: 11200, z2: 2255, label: '960 mm', textX: 11200, textZ: 1775, refX1: 10400, refZ1: 1295, refX2: 10400, refZ2: 2255 }
];

// --- 가구/가전 카탈로그 데이터 정의 ---
const CATALOG = [
    { id: 'bed_queen', name: '퀸사이즈 침대', category: 'living', icon: 'fa-bed', width: 1600, depth: 2100, height: 900, color: '#c2b3a3', type: 'bed' },
    { id: 'sofa_3seater', name: '3인용 소파', category: 'living', icon: 'fa-couch', width: 2000, depth: 900, height: 800, color: '#4b5563', type: 'sofa' },
    { id: 'wardrobe', name: '옷장', category: 'living', icon: 'fa-door-closed', width: 1200, depth: 600, height: 2000, color: '#d1bfa7', type: 'cabinet' },
    { id: 'desk', name: '컴퓨터 책상', category: 'living', icon: 'fa-desktop', width: 1400, depth: 700, height: 750, color: '#5c4033', type: 'desk' },
    { id: 'chair', name: '사무용 의자', category: 'living', icon: 'fa-chair', width: 600, depth: 600, height: 900, color: '#1e293b', type: 'chair' },
    { id: 'dining_table', name: '4인용 식탁', category: 'kitchen', icon: 'fa-table', width: 1400, depth: 800, height: 750, color: '#8b5a2b', type: 'table' },
    { id: 'kitchen_cabinet', name: '싱크대 상하부장', category: 'kitchen', icon: 'fa-kitchen-set', width: 1800, depth: 650, height: 850, color: '#f8fafc', type: 'cabinet' },
    { id: 'refrigerator', name: '양문형 냉장고', category: 'appliances', icon: 'fa-refrigerator', width: 912, depth: 915, height: 1780, color: '#94a3b8', type: 'refrigerator' },
    { id: 'washing_machine', name: '드럼 세탁기', category: 'appliances', icon: 'fa-soap', width: 600, depth: 650, height: 850, color: '#e2e8f0', type: 'washer' },
    { id: 'tv_stand', name: 'TV & 거실장', category: 'appliances', icon: 'fa-tv', width: 1600, depth: 450, height: 1200, color: '#1f2937', type: 'tv' }
];

// --- 애플리케이션 초기 실행 ---
window.addEventListener('DOMContentLoaded', () => {
    initThreeJS();
    generateProceduralTextures();
    buildApartment();
    buildDimensionGuides(); 
    
    // 신규 가구/가전 모듈(appliances_furniture.js)의 데이터를 기존 카탈로그에 동적 병합
    if (typeof NEW_CATALOG !== 'undefined' && Array.isArray(NEW_CATALOG)) {
        CATALOG.push(...NEW_CATALOG);
    }
    
    initCatalog();
    initUIEventListeners();
    
    // [초기 가구 자동 생성 복원] 벽걸이 TV와 모션데스크를 설정된 정밀 초기 위치에 스폰하여 배치해 둡니다.
    // 1. 신규 벽걸이 TV 초기 자동 배치 (거실 서측 아트월 중앙 부착)
    addFurnitureToRoom('new_tv_wall', {
        x: getWorldX(3760) + 0.04 + 0.01385, // 벽면 마감(X=3760) + 브래킷 두께(0.04m) + TV 두께 절반(0.01385m)
        y: 0.7713,                           // TV 중심선 1.25m 기준 가구 하단 오프셋 (1.25 - 0.4787)
        z: getWorldZ(4295),                  // 거실 중심 Z = 4295
        rotation: Math.PI / 2                // 거실 중심을 향해 동쪽(+X)을 보도록 회전
    });

    // 2. 신규 핏쳐 모션데스크 E2 초기 자동 배치 (침실2 내 남측 창가 근처)
    addFurnitureToRoom('fiture_desk_e2', {
        x: getWorldX(7580),
        y: 0,
        z: getWorldZ(2200),
        rotation: 0
    });

    // 3. 신규 퓨어화이트 2단 행거형 800 초기 자동 배치 (침실2 북벽 서측)
    addFurnitureToRoom('layout_hanger_800', {
        x: getWorldX(7580 + 400 + 100), // X = 8080. 침실2 서측 벽에서 약 10cm 마진
        y: 0,
        z: getWorldZ(5945) - 0.2,        // 깊이 40cm의 절반인 20cm 아래로 북벽에 딱 밀착
        rotation: Math.PI                // 남향으로 180도 회전
    });

    // 4. 신규 퓨어화이트 긴 옷 행거형 600 초기 자동 배치 (침실2 북벽 동측 - 800 행거와 정밀 밀착 결합)
    addFurnitureToRoom('layout_hanger_600', {
        x: getWorldX(7580 + 400 + 100) + 0.4 + 0.3, // X = 8780. 800 행거 바로 옆에 딱 맞물림
        y: 0,
        z: getWorldZ(5945) - 0.2,        // 깊이 40cm의 절반인 20cm 아래로 북벽에 딱 밀착
        rotation: Math.PI                // 남향으로 180도 회전
    });

    // 5. 신규 삼성 비스포크 AI 콤보 + 수납함 초기 자동 배치 (발코니2 북동측 구석 수전 자리)
    addFurnitureToRoom('samsung_combo_laundry', {
        x: getWorldX(3650 - 343 - 50),   // X = 3257. 동측 외벽에서 약 5cm 마진
        y: 0,
        z: getWorldZ(9060 + 393 + 100),  // Z = 9553. 북측 벽면에서 배관 공간 고려 약 10cm 마진
        rotation: -Math.PI / 2           // 드럼 문과 LCD 콘솔이 발코니 안쪽(서쪽)을 향하도록 회전
    });
    
    animate();
});

// --- Three.js 엔진 세팅 ---
function initThreeJS() {
    const container = document.getElementById('canvas-container');
    
    scene = new THREE.Scene();
    
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    resetCameraPosition();
    
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0); 
    // 밝은 영역이 타서 날아가는 것을 방지하기 위해 물리 기반 ACES 톤 매핑과 노출도(0.85) 적용
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    container.appendChild(renderer.domElement);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // 기존 0.2에서 사용자의 200% 조명 요구에 따라 0.4로 상향
    scene.add(ambientLight);
    
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.12); // 기존 0.06에서 0.12로 상향
    hemiLight.position.set(0, 10, 0);
    scene.add(hemiLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5); // 기존 0.25에서 0.5로 상향
    dirLight.position.set(5, 12, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 30;
    
    const d = 10;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0003;
    scene.add(dirLight);

    const pointLight1 = new THREE.PointLight(0xfff8e7, 0.2, 20); // 기존 0.1에서 0.2로 상향
    pointLight1.position.set(-3, 4, -3);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xe7f0ff, 0.16, 20); // 기존 0.08에서 0.16으로 상향
    pointLight2.position.set(3, 4, 3);
    scene.add(pointLight2);
    
    // 글로벌 및 로컬 조명 조절용 참조 객체 초기화 (HTML 슬라이더 연동용)
    window.appLights = {
        global: [
            { obj: ambientLight, defaultVal: 0.4 },
            { obj: hemiLight, defaultVal: 0.12 },
            { obj: dirLight, defaultVal: 0.5 },
            { obj: pointLight1, defaultVal: 0.2 },
            { obj: pointLight2, defaultVal: 0.16 }
        ],
        living: [],
        bedroom1: [],
        dressroom: [],
        kitchen: [],
        bedroom2: []
    };
    
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 2;
    controls.maxDistance = 35;
    
    window.addEventListener('resize', onWindowResize);
}

function resetCameraPosition() {
    if (is2DMode) {
        camera.position.set(0, 14, 0);
        camera.lookAt(0, 0, 0);
    } else {
        camera.position.set(0, 10, 12);
        camera.lookAt(0, 0, 0);
    }
    if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
    }
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// --- 실사 패턴에 어울리는 마루 및 타일 텍스처 자체 생성 ---
function generateProceduralTextures() {
    const canvasWood = document.createElement('canvas');
    canvasWood.width = 512;
    canvasWood.height = 512;
    const ctxW = canvasWood.getContext('2d');
    ctxW.fillStyle = '#eae5dc'; // 밝고 뽀얀 베이지/아이보리 톤으로 수정
    ctxW.fillRect(0, 0, 512, 512);
    ctxW.strokeStyle = '#cdc2b5'; // 은은한 마루 줄눈선으로 수정
    ctxW.lineWidth = 3;
    
    const pW = 64;
    const pH = 128;
    for (let x = 0; x < 512; x += pW) {
        ctxW.beginPath();
        ctxW.moveTo(x, 0);
        ctxW.lineTo(x, 512);
        ctxW.stroke();
        
        const offset = (x / pW) % 2 === 0 ? 0 : pH / 2;
        for (let y = offset; y < 512 + pH; y += pH) {
            ctxW.beginPath();
            ctxW.moveTo(x, y);
            ctxW.lineTo(x + pW, y);
            ctxW.stroke();
        }
    }
    
    ctxW.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let i = 0; i < 800; i++) {
        ctxW.fillRect(Math.random()*512, Math.random()*512, Math.random()*120+40, 2);
    }
    
    const woodTex = new THREE.CanvasTexture(canvasWood);
    woodTex.wrapS = THREE.RepeatWrapping;
    woodTex.wrapT = THREE.RepeatWrapping;
    woodTex.needsUpdate = true; // 갱신 반영 설정
    floorTextures['wood'] = woodTex;

    // 침실2 전용 정밀 화이트 오크 강마루 텍스처 생성 (실사 사진 기반 라이트 우드 모사)
    const canvasBed2Wood = document.createElement('canvas');
    canvasBed2Wood.width = 512;
    canvasBed2Wood.height = 512;
    const ctxB2 = canvasBed2Wood.getContext('2d');
    ctxB2.fillStyle = '#dfd7ca'; // 오버익스포저 방지를 위해 실제 베이지톤보다 톤다운
    ctxB2.fillRect(0, 0, 512, 512);
    ctxB2.strokeStyle = '#bdae9c'; // 줄눈선이 선명하게 보이도록 더 짙은 갈색 적용
    ctxB2.lineWidth = 2;
    
    // 줄눈 무늬
    for (let x = 0; x < 512; x += 48) {
        ctxB2.beginPath();
        ctxB2.moveTo(x, 0);
        ctxB2.lineTo(x, 512);
        ctxB2.stroke();
        
        const offset = (x / 48) % 2 === 0 ? 0 : 96;
        for (let y = offset; y < 512 + 192; y += 192) {
            ctxB2.beginPath();
            ctxB2.moveTo(x, y);
            ctxB2.lineTo(x + 48, y);
            ctxB2.stroke();
        }
    }
    
    // 은은한 나무결 표현 (밝고 어두운 결을 복합 배치하여 실사 느낌 극대화)
    ctxB2.fillStyle = 'rgba(255, 255, 255, 0.15)';
    for (let i = 0; i < 300; i++) {
        ctxB2.fillRect(Math.random()*512, Math.random()*512, Math.random()*80+20, 1.5);
    }
    ctxB2.fillStyle = 'rgba(0, 0, 0, 0.04)';
    for (let i = 0; i < 200; i++) {
        ctxB2.fillRect(Math.random()*512, Math.random()*512, Math.random()*60+20, 1.2);
    }
    
    const bed2WoodTex = new THREE.CanvasTexture(canvasBed2Wood);
    bed2WoodTex.wrapS = THREE.RepeatWrapping;
    bed2WoodTex.wrapT = THREE.RepeatWrapping;
    bed2WoodTex.needsUpdate = true; // 갱신 반영 설정
    floorTextures['bedroom2_wood'] = bed2WoodTex;

    const canvasTile = document.createElement('canvas');
    canvasTile.width = 128;
    canvasTile.height = 128;
    const ctxT = canvasTile.getContext('2d');
    // 조명 반사로 인한 과노출을 방지하기 위해 타일 기본 바탕색을 조금 더 차분한 회색(#d1d5db)으로 톤다운
    ctxT.fillStyle = '#d1d5db';
    ctxT.fillRect(0, 0, 128, 128);
    ctxT.strokeStyle = '#cbd5e1';
    ctxT.lineWidth = 2;
    ctxT.strokeRect(0, 0, 128, 128);
    
    const tileTex = new THREE.CanvasTexture(canvasTile);
    tileTex.wrapS = THREE.RepeatWrapping;
    tileTex.wrapT = THREE.RepeatWrapping;
    tileTex.needsUpdate = true; // 갱신 반영 설정
    floorTextures['tile'] = tileTex;

    const canvasDark = document.createElement('canvas');
    canvasDark.width = 128;
    canvasDark.height = 128;
    const ctxD = canvasDark.getContext('2d');
    ctxD.fillStyle = '#4b5563';
    ctxD.fillRect(0, 0, 128, 128);
    ctxD.strokeStyle = '#1f2937';
    ctxD.lineWidth = 2;
    ctxD.strokeRect(0, 0, 128, 128);
    
    const darkTex = new THREE.CanvasTexture(canvasDark);
    darkTex.wrapS = THREE.RepeatWrapping;
    darkTex.wrapT = THREE.RepeatWrapping;
    darkTex.needsUpdate = true; // 갱신 반영 설정
    floorTextures['dark'] = darkTex;

    // 거실 아트월 전용 타일 텍스처 생성 (1024x1024 고해상도 줄눈 격자 포함)
    const canvasArtwall = document.createElement('canvas');
    canvasArtwall.width = 1024;
    canvasArtwall.height = 1024;
    const ctxA = canvasArtwall.getContext('2d');

    // 1. 바탕 그라데이션 (웜그레이 샌드스톤)
    const grad = ctxA.createLinearGradient(0, 0, 1024, 1024);
    grad.addColorStop(0, '#eae6de');
    grad.addColorStop(0.5, '#e3ded5');
    grad.addColorStop(1, '#dad5cb');
    ctxA.fillStyle = grad;
    ctxA.fillRect(0, 0, 1024, 1024);

    // 2. 부드러운 샌드스톤 질감 (노이즈 방지를 위해 고운 미세 도트)
    ctxA.fillStyle = 'rgba(255, 255, 255, 0.22)';
    for(let i=0; i<1500; i++) {
        ctxA.fillRect(Math.random()*1024, Math.random()*1024, 2, 2);
    }
    ctxA.fillStyle = 'rgba(150, 140, 130, 0.08)';
    for(let i=0; i<1200; i++) {
        ctxA.fillRect(Math.random()*1024, Math.random()*1024, 3, 3);
    }

    // 3. 3x2 타일 줄눈 드로잉 (어두운 회색의 부드러운 음영선)
    ctxA.strokeStyle = 'rgba(40, 40, 40, 0.5)';
    ctxA.lineWidth = 4;
    
    // 가로줄 (세로 높이의 정중앙 Y=512)
    ctxA.beginPath();
    ctxA.moveTo(0, 512);
    ctxA.lineTo(1024, 512);
    ctxA.stroke();

    // 세로줄 (가로 폭의 3등분선 X=341, X=683)
    ctxA.beginPath();
    ctxA.moveTo(341, 0);
    ctxA.lineTo(341, 1024);
    ctxA.moveTo(683, 0);
    ctxA.lineTo(683, 1024);
    ctxA.stroke();

    // 외곽 테두리 줄눈
    ctxA.strokeStyle = 'rgba(40, 40, 40, 0.3)';
    ctxA.lineWidth = 6;
    ctxA.strokeRect(0, 0, 1024, 1024);

    const artwallTex = new THREE.CanvasTexture(canvasArtwall);
    artwallTex.wrapS = THREE.ClampToEdgeWrapping;
    artwallTex.wrapT = THREE.ClampToEdgeWrapping;
    artwallTex.needsUpdate = true;
    floorTextures['living_artwall'] = artwallTex;
}

// --- 49A형 전체 아파트 동적 3D 렌더링 알고리즘 ---
function buildApartment() {
    roomFloors.forEach(floor => scene.remove(floor));
    roomFloors = [];
    roomWalls.forEach(wall => scene.remove(wall));
    roomWalls = [];
    
    const t = wallThickness * MM_TO_UNIT; 
    const h = WALL_HEIGHT * MM_TO_UNIT; 

    // 1. 방별 독립된 바닥(Floor) 메시 생성
    ROOMS_DATA.forEach(room => {
        const rw = room.w * MM_TO_UNIT;
        const rd = room.d * MM_TO_UNIT;
        
        const floorGeo = new THREE.PlaneGeometry(rw, rd);
        
        let tex = floorTextures[room.floorPreset];
        if (room.floorPreset === 'wood' && floorTextures['custom_floor']) {
            tex = floorTextures['custom_floor'];
        } else if (room.floorPreset === 'tile' && floorTextures['custom_floor_tile']) {
            tex = floorTextures['custom_floor_tile'];
        }
        
        let clonedTex = null;
        if (tex) {
            if (typeof tex.clone === 'function') {
                clonedTex = tex.clone();
                clonedTex.needsUpdate = true;
            } else {
                clonedTex = tex; // clone 메서드가 없는 테스트 환경용 방어적 대응
            }
            clonedTex.repeat.set(rw * 2, rd * 2); // 각 방의 면적에 맞게 복제된 텍스처의 repeat 독점 적용
        }
        
        const floorMat = new THREE.MeshStandardMaterial({
            map: clonedTex,
            roughness: 0.85, // 표면 거칠기를 높여 과도한 조명 반사광 차단
            metalness: 0.02
        });
        
        const floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        
        const posX = getWorldX(room.x + room.w / 2);
        const posZ = getWorldZ(room.z + room.d / 2);
        // 발코니2 바닥은 -5cm 낮게 설정하여 물빠짐 단차 구현
        const posY = room.id === 'balcony2' ? -0.05 : 0;
        floorMesh.position.set(posX, posY, posZ);
        floorMesh.receiveShadow = true;
        
        floorMesh.userData = { roomId: room.id, name: room.name };
        scene.add(floorMesh);
        roomFloors.push(floorMesh);
    });

    // 1.1 아파트 전체 통합 기저 바닥판(Base Floor Plate) 생성 (문밑 틈새 및 복도 바닥 검은 구멍 메움)
    const baseW = 10400 * MM_TO_UNIT;
    const baseD = 11170 * MM_TO_UNIT;
    const baseGeo = new THREE.BoxGeometry(baseW, 0.005, baseD);
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0xeeeeee, // 아이보리 화이트/연그레이 톤으로 부드러운 하단 마감
        roughness: 0.95,
        metalness: 0.01
    });
    const baseFloor = new THREE.Mesh(baseGeo, baseMat);
    baseFloor.position.set(
        getWorldX(10400 / 2),
        -0.003, // 방 바닥(Y=0)보다 3mm 아래에 깔아 z-fighting 방지 및 틈 메움
        getWorldZ(11170 / 2)
    );
    baseFloor.receiveShadow = true;
    baseFloor.name = "baseFloorPlate";
    scene.add(baseFloor);
    roomFloors.push(baseFloor);

    // 2. 아파트 전체 격자 헬퍼 그리드 추가
    const gridHelper = new THREE.GridHelper(15, 30, 0x6366f1, 0x334155);
    gridHelper.position.set(0, 0.001, 0);
    gridHelper.material.opacity = 0.15;
    gridHelper.material.transparent = true;
    gridHelper.name = "gridHelper";
    
    const oldGrid = scene.getObjectByName("gridHelper");
    if (oldGrid) scene.remove(oldGrid);
    scene.add(gridHelper);
    // 3D 뷰에서 격자 자글거림을 없애기 위해 2D 모드일 때만 격자선 가시화
    gridHelper.visible = is2DMode;

    // 3. 가변 벽체(Wall) 생성
    const activeWallPreset = document.querySelector('.preset-item.active[data-type="wall"]');
    const wallPresetName = activeWallPreset ? activeWallPreset.dataset.preset : 'white';
    
    let wallColor = '#f3f4f6';
    if (wallPresetName === 'gray') wallColor = '#a1a1aa';
    if (wallPresetName === 'beige') wallColor = '#e4e4e7';
    
    const wallMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(wallColor),
        roughness: 0.85,
        metalness: 0.02,
        side: THREE.DoubleSide
    });
    
    if (wallTextures['custom']) {
        wallMat.color.set('#ffffff');
        wallMat.map = wallTextures['custom'];
        wallMat.map.wrapS = THREE.RepeatWrapping;
        wallMat.map.wrapT = THREE.RepeatWrapping;
    }

    WALL_SEGMENTS.forEach(seg => {
        const segT = (seg.thickness ? seg.thickness : wallThickness) * MM_TO_UNIT;
        if (seg.hasDoor) {
            const dStart = seg.doorPos;
            const dW = seg.doorWidth;
            const dEnd = dStart + dW;
            
            if (seg.x1 === seg.x2) {
                if (dStart > seg.z1) {
                    createWallMeshFromSegment(seg.x1, seg.z1, seg.x2, dStart, segT, h, 0, wallMat);
                }
                createWallMeshFromSegment(seg.x1, dStart, seg.x2, dEnd, segT, 200 * MM_TO_UNIT, 2100 * MM_TO_UNIT, wallMat);
                if (seg.z2 > dEnd) {
                    createWallMeshFromSegment(seg.x1, dEnd, seg.x2, seg.z2, segT, h, 0, wallMat);
                }
            } else {
                if (dStart > seg.x1) {
                    createWallMeshFromSegment(seg.x1, seg.z1, dStart, seg.z2, segT, h, 0, wallMat);
                }
                createWallMeshFromSegment(dStart, seg.z1, dEnd, seg.z2, segT, 200 * MM_TO_UNIT, 2100 * MM_TO_UNIT, wallMat);
                if (seg.x2 > dEnd) {
                    createWallMeshFromSegment(dEnd, seg.z1, seg.x2, seg.z2, segT, h, 0, wallMat);
                }
            }
        } else if (seg.hasWindow) {
            const winMin = seg.winMinY * MM_TO_UNIT; 
            const winMax = seg.winMaxY * MM_TO_UNIT; 
            const totalH = WALL_HEIGHT * MM_TO_UNIT; 
            
            // 1. 창문 하부 벽 (Y = 0 ~ winMin)
            createWallMeshFromSegment(seg.x1, seg.z1, seg.x2, seg.z2, segT, winMin, 0, wallMat);
            
            // 2. 창문 상부 인방 벽 (Y = winMax ~ totalH)
            const topH = totalH - winMax; 
            createWallMeshFromSegment(seg.x1, seg.z1, seg.x2, seg.z2, segT, topH, winMax, wallMat);
        } else {
            createWallMeshFromSegment(seg.x1, seg.z1, seg.x2, seg.z2, segT, h, 0, wallMat, seg.isArtwall);
        }
    });

    // 침실2, 거실, 안방, 주방 및 발코니2 정밀 실사 모사 구성물 배치 실행
    buildBedroom2Details();
    buildLivingRoomDetails();
    buildBedroom1Details();
    buildKitchenDetails();
    buildBalcony2Details();

    buildRoomLabelsDOM();
    updateRoomLabels();
    updateWallsVisibility();
    
    // 조명 재생성 시 기존 슬라이더 설정값 강제 재적용
    applyCurrentLightSettings();
}

// 기존 슬라이더들의 % 값을 새로 신설/재생성된 조명들에 대입 적용하는 동기화 함수
function applyCurrentLightSettings() {
    if (!window.appLights) return;
    const categories = ['global', 'living', 'bedroom1', 'dressroom', 'kitchen', 'bedroom2'];
    categories.forEach(cat => {
        const slider = document.getElementById(`light-${cat}`);
        if (!slider) return;
        const pct = parseInt(slider.value) || 100;
        const multiplier = pct / 100;
        const lights = window.appLights[cat];
        if (lights) {
            lights.forEach(item => {
                if (item.obj) {
                    item.obj.intensity = item.defaultVal * multiplier;
                }
            });
        }
    });
}

function createWallMeshFromSegment(x1, z1, x2, z2, thickness, height, elevation, material, isArtwall = false) {
    const wx1 = getWorldX(x1);
    const wz1 = getWorldZ(z1);
    const wx2 = getWorldX(x2);
    const wz2 = getWorldZ(z2);
    
    const dx = wx2 - wx1;
    const dz = wz2 - wz1;
    const len = Math.sqrt(dx * dx + dz * dz);
    const ang = Math.atan2(dz, dx);
    
    // 발코니2 (X = 1235~3650, Z = 9060~11170) 소속 벽체 하단선 5cm 다운 보정 (바닥 틈새 메움)
    const cx_mm = (x1 + x2) / 2;
    const cz_mm = (z1 + z2) / 2;
    let adjustedHeight = height;
    let adjustedElevation = elevation;
    
    if (cx_mm >= 1185 && cx_mm <= 3700 && cz_mm >= 9010 && cz_mm <= 11220) {
        adjustedHeight = height + 0.05;
        adjustedElevation = elevation - 0.05;
    }
    
    const wallGeo = new THREE.BoxGeometry(len, adjustedHeight, thickness);
    let wallMatOrArray;
    
    if (isArtwall && floorTextures['living_artwall']) {
        const artwallMat = new THREE.MeshStandardMaterial({
            map: floorTextures['living_artwall'],
            roughness: 0.65,
            metalness: 0.02
        });
        artwallMat.map.wrapS = THREE.ClampToEdgeWrapping;
        artwallMat.map.wrapT = THREE.ClampToEdgeWrapping;
        artwallMat.map.repeat.set(1, 1);
        
        // 투명도 조절 시 벽면 간 간섭을 원천 차단하기 위해 공유 재질(material)을 각각 복제(clone)하여 할당합니다.
        const m0 = material.clone();
        const m1 = material.clone();
        const m2 = material.clone();
        const m3 = material.clone();
        const m5 = material.clone();
        
        // 3D 상에서 Y축 회전 배치된 벽체 박스의 넓은 양면은 로컬 Z축 면입니다.
        // 4: 로컬 +Z 면 (월드 +X 거실 내부 방향) -> 대리석 아트월 적용
        // 5: 로컬 -Z 면 (월드 -X 안방 내부 방향) -> 일반 실크 벽지 적용
        wallMatOrArray = [
            m0,          // 0: +X
            m1,          // 1: -X
            m2,          // 2: +Y
            m3,          // 3: -Y
            artwallMat,  // 4: +Z (거실 쪽 대리석 아트월)
            m5           // 5: -Z (안방 쪽 일반 실크 벽지)
        ];
    } else {
        const matCopy = material.clone();
        if (matCopy.map) {
            matCopy.map.repeat.set(len * 2, adjustedHeight * 2);
        }
        wallMatOrArray = matCopy;
    }
    
    const wallMesh = new THREE.Mesh(wallGeo, wallMatOrArray);
    
    const cx = wx1 + dx / 2;
    const cz = wz1 + dz / 2;
    const cy = (adjustedHeight / 2) + adjustedElevation;
    
    wallMesh.position.set(cx, cy, cz);
    wallMesh.rotation.y = -ang; 
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    
    scene.add(wallMesh);
    roomWalls.push(wallMesh);
}

// --- 침실2 실사 기반 내부 장치 3D 렌더링 알고리즘 (리사이징 반영) ---
function buildBedroom2Details() {
    // 기존에 있던 침실2 관련 정밀 묘사 메시 삭제
    detailObjects.forEach(obj => {
        if (obj.parent) obj.parent.remove(obj);
    });
    // detailObjects 배열 비우기
    detailObjects = [];
    
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xfcfcfc, roughness: 0.8, metalness: 0.05 });
    const matBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.1 });
    const matGlass = new THREE.MeshStandardMaterial({ color: 0xb2cdd4, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.35 });
    const matGray = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.5, metalness: 0.3 }); // 전기 콘센트 플레이트 색
    const matSkirting = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.9, metalness: 0.02 }); // 걸레받이 색상 (웜화이트)

    // 1. 빌트인 시스템 에어컨 (남쪽 창문 위 천장 묘사)
    const acGroup = new THREE.Group();
    const acBodyGeo = new THREE.BoxGeometry(1.2, 0.02, 0.45);
    const acBody = new THREE.Mesh(acBodyGeo, matWhite);
    acGroup.add(acBody);

    const acBladeGeo = new THREE.BoxGeometry(1.0, 0.005, 0.08);
    const acBlade = new THREE.Mesh(acBladeGeo, matGray);
    acBlade.position.set(0, -0.008, 0.1);
    acGroup.add(acBlade);

    // 에어컨 위치: 남측벽 창문 위 천장 (Y=2.29), 방 내부 Z=2795 (Z: 2025 -> 2795)
    acGroup.position.set(getWorldX(9130), 2.29, getWorldZ(2795));
    scene.add(acGroup);
    detailObjects.push(acGroup);

    // 2. 심플 원형 LED 천장 면조명 & 광원 추가
    const lightGroup = new THREE.Group();
    const ledGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 32);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ledMesh = new THREE.Mesh(ledGeo, ledMat);
    lightGroup.add(ledMesh);

    // LED 등 위치: 방 중앙 (X=8930, Z=4220) (Z: 3450 -> 4220)
    const ledX = 8930;
    const ledZ = 4220;
    lightGroup.position.set(getWorldX(ledX), 2.27, getWorldZ(ledZ));
    
    const roomLight = new THREE.PointLight(0xfffdf4, 0.15, 12); // 조도 0.35에서 0.15로 하향하여 과노출 방지
    roomLight.position.set(0, -0.2, 0);
    roomLight.castShadow = true;
    roomLight.shadow.bias = -0.0002;
    lightGroup.add(roomLight);

    // 침실2 로컬 조명 등록
    window.appLights.bedroom2 = [{ obj: roomLight, defaultVal: 0.15 }];

    scene.add(lightGroup);
    detailObjects.push(lightGroup);

    // 3. 방문 무광 블랙 레버 손잡이 (경첩 피벗 회전 그룹화)
    doorPivot = new THREE.Group();
    doorPivot.name = "bedroom2_door_pivot";
    // 경첩 위치: 북측 내벽선 Z=5945 상의 X=7700 (방문의 서측 끝) (Z: 5175 -> 5945)
    doorPivot.position.set(getWorldX(7700), 0, getWorldZ(5945));
    
    isDoorOpen = true;
    doorPivot.rotation.y = -Math.PI * 0.47; 

    const doorPanelGeo = new THREE.BoxGeometry(0.9, 2.1, 0.04);
    const doorPanel = new THREE.Mesh(doorPanelGeo, matWhite);
    doorPanel.name = "bedroom2_door_panel";
    doorPanel.position.set(0.45, 1.05, 0);
    doorPivot.add(doorPanel);
    
    const handleGroup = new THREE.Group();
    const rosetteGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.006, 16);
    rosetteGeo.rotateX(Math.PI / 2);
    const rosette = new THREE.Mesh(rosetteGeo, matBlack);
    handleGroup.add(rosette);

    const barGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.04, 16);
    barGeo.rotateX(Math.PI / 2);
    const bar = new THREE.Mesh(barGeo, matBlack);
    bar.position.set(0, 0, 0.02);
    handleGroup.add(bar);

    const leverGeo = new THREE.BoxGeometry(0.12, 0.012, 0.02);
    const lever = new THREE.Mesh(leverGeo, matBlack);
    lever.position.set(-0.05, 0, 0.04);
    handleGroup.add(lever);

    // 손잡이는 문짝(doorPanel)의 끝부분인 로컬 X=0.38 (문짝 가로폭 0.9m 끝자락인 0.45에서 7cm 안쪽)에 부착
    handleGroup.position.set(0.38, -0.05, 0.02);
    doorPanel.add(handleGroup);

    const handleBack = handleGroup.clone();
    handleBack.position.z = -0.02;
    handleBack.rotation.y = Math.PI;
    doorPanel.add(handleBack);

    scene.add(doorPivot);
    detailObjects.push(doorPivot);
    roomWalls.push(doorPivot);

    // 4. 벽면 온도조절기 & 스위치 플레이트 (방문 우측 가벽 Z = 6055 상의 X = 8840) (Z: 5285 -> 6055)
    const switchGroup = new THREE.Group();
    const thermostat = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.005), matBlack);
    thermostat.position.set(0, 0.08, 0.005);
    switchGroup.add(thermostat);

    const wallSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.005), matGray);
    wallSwitch.position.set(0, -0.04, 0.005);
    switchGroup.add(wallSwitch);

    switchGroup.position.set(getWorldX(8840), 1.12, getWorldZ(6055) + (220*MM_TO_UNIT)/2 + 0.002);
    scene.add(switchGroup);
    detailObjects.push(switchGroup);

    // 5. 방문 좌측벽 분전반/배전함 커버 2종 (방 내부 좌측벽 X = 7580, Z = 5295 부근) (Z: 4525 -> 5295)
    const panelGroup = new THREE.Group();
    const box1 = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.3, 0.3), matWhite);
    box1.position.set(0.002, 1.6, 0);
    panelGroup.add(box1);

    const box2 = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.45, 0.3), matWhite);
    box2.position.set(0.002, 0.9, 0);
    panelGroup.add(box2);

    panelGroup.position.set(getWorldX(7470) + (220*MM_TO_UNIT)/2 + 0.002, 0, getWorldZ(5295));
    scene.add(panelGroup);
    detailObjects.push(panelGroup);

    // 6. 벽 하단 콘센트 플레이트 (바닥에서 30cm)
    const createOutlet = (x, y, z, rotY) => {
        const outlet = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.005), matGray);
        outlet.position.set(x, y, z);
        outlet.rotation.y = rotY;
        scene.add(outlet);
        detailObjects.push(outlet);
    };

    // 서측 벽면(X=7580) 창가 부근 하단 (Z: 2075 -> 2845)
    createOutlet(getWorldX(7470) + (220*MM_TO_UNIT)/2 + 0.003, 0.3, getWorldZ(2845), Math.PI / 2);
    // 동측 벽면(X=10280) 창가 부근 하단 (Z: 2075 -> 2845)
    createOutlet(getWorldX(10400) - (240*MM_TO_UNIT)/2 - 0.003, 0.3, getWorldZ(2845), -Math.PI / 2);
    // 북쪽 벽면(Z=6055) 방문 우측 스위치 하단 (Z: 5285 -> 6055)
    createOutlet(getWorldX(8840), 0.3, getWorldZ(6055) + (220*MM_TO_UNIT)/2 + 0.002, 0);

    // 7. 창문 (남측 Z=2385 벽의 가로 X=8280 ~ 9980 사이 창문) (Z: 1615 -> 2385)
    const windowGroup = new THREE.Group();
    const frameThick = 0.04; 
    const frameDepth = 0.12;
    
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(1.7, frameThick, frameDepth), matWhite);
    frameTop.position.set(0, 1.1/2 - frameThick/2, 0);
    windowGroup.add(frameTop);
    
    const frameBottom = new THREE.Mesh(new THREE.BoxGeometry(1.7, frameThick, frameDepth), matWhite);
    frameBottom.position.set(0, -1.1/2 + frameThick/2, 0);
    windowGroup.add(frameBottom);
    
    const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(frameThick, 1.1 - frameThick*2, frameDepth), matWhite);
    frameLeft.position.set(-1.7/2 + frameThick/2, 0, 0);
    windowGroup.add(frameLeft);
    
    const frameRight = new THREE.Mesh(new THREE.BoxGeometry(frameThick, 1.1 - frameThick*2, frameDepth), matWhite);
    frameRight.position.set(1.7/2 - frameThick/2, 0, 0);
    windowGroup.add(frameRight);
    
    const glass1 = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.98, 0.03), matGlass);
    glass1.position.set(-0.4, 0, -0.02);
    windowGroup.add(glass1);

    const glass2 = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.98, 0.03), matGlass);
    glass2.position.set(0.4, 0, 0.02);
    windowGroup.add(glass2);

    windowGroup.position.set(getWorldX(9130), (1.1/2) + 1.13, getWorldZ(2385));
    scene.add(windowGroup);
    detailObjects.push(windowGroup);

    // 8. 바닥 테두리 걸레받이
    const skirtThick = 0.01;
    const skirtHeight = 0.06;

    // 8.1 남쪽 걸레받이 (Z=2495) (Z: 1725 -> 2495)
    const skirtS = new THREE.Mesh(new THREE.BoxGeometry(2.7, skirtHeight, skirtThick), matSkirting);
    skirtS.position.set(getWorldX(8930), skirtHeight/2, getWorldZ(2495) - skirtThick/2);
    scene.add(skirtS);
    detailObjects.push(skirtS);

    // 8.2 북쪽 걸레받이 (Z=5945) (Z: 5175 -> 5945)
    // 서쪽 가벽 (X = 7580 ~ 7700, 폭 12cm)
    const skirtNW = new THREE.Mesh(new THREE.BoxGeometry(0.12, skirtHeight, skirtThick), matSkirting);
    skirtNW.position.set(getWorldX(7580 + 60), skirtHeight/2, getWorldZ(5945) + skirtThick/2);
    scene.add(skirtNW);
    detailObjects.push(skirtNW);

    // 동쪽 가벽 (X = 8600 ~ 10280, 폭 1.68m)
    const skirtNE = new THREE.Mesh(new THREE.BoxGeometry(1.68, skirtHeight, skirtThick), matSkirting);
    skirtNE.position.set(getWorldX(8600 + 840), skirtHeight/2, getWorldZ(5945) + skirtThick/2);
    scene.add(skirtNE);
    detailObjects.push(skirtNE);

    // 8.3 서쪽 걸레받이 (X=7580, 세로 3.45m, 중심 Z=4220) (Z: 3450 -> 4220)
    const skirtW = new THREE.Mesh(new THREE.BoxGeometry(3.45, skirtHeight, skirtThick), matSkirting);
    skirtW.rotation.y = Math.PI / 2;
    skirtW.position.set(getWorldX(7580) + skirtThick/2, skirtHeight/2, getWorldZ(4220));
    scene.add(skirtW);
    detailObjects.push(skirtW);

    // 8.4 동쪽 걸레받이 (X=10280, 세로 3.45m, 중심 Z=4220) (Z: 3450 -> 4220)
    const skirtE = new THREE.Mesh(new THREE.BoxGeometry(3.45, skirtHeight, skirtThick), matSkirting);
    skirtE.rotation.y = Math.PI / 2;
    skirtE.position.set(getWorldX(10280) - skirtThick/2, skirtHeight/2, getWorldZ(4220));
    scene.add(skirtE);
    detailObjects.push(skirtE);
}

// --- 거실 실사 정밀 렌더링 알고리즘 ---
function buildLivingRoomDetails() {
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xfcfcfc, roughness: 0.8, metalness: 0.05 });
    const matBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.1 });
    const matGray = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.5, metalness: 0.3 }); // 전기 콘센트 실버/그레이
    const matGlass = new THREE.MeshStandardMaterial({ color: 0xb2cdd4, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.35 });
    const matSkirting = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.9, metalness: 0.02 }); // 걸레받이
    const wallT2 = 220 * MM_TO_UNIT; // 내벽
    const winW = 2.7;
    const winH = 2.0;
    const frameThick = 0.04;
    const frameDepth = 0.15;

    const windowGroup = new THREE.Group();
    const fTop = new THREE.Mesh(new THREE.BoxGeometry(winW, frameThick, frameDepth), matWhite);
    fTop.position.set(0, winH/2 - frameThick/2, 0);
    windowGroup.add(fTop);
    const fBottom = new THREE.Mesh(new THREE.BoxGeometry(winW, frameThick, frameDepth), matWhite);
    fBottom.position.set(0, -winH/2 + frameThick/2, 0);
    windowGroup.add(fBottom);
    const fLeft = new THREE.Mesh(new THREE.BoxGeometry(frameThick, winH - frameThick*2, frameDepth), matWhite);
    fLeft.position.set(-winW/2 + frameThick/2, 0, 0);
    windowGroup.add(fLeft);
    const fRight = new THREE.Mesh(new THREE.BoxGeometry(frameThick, winH - frameThick*2, frameDepth), matWhite);
    fRight.position.set(winW/2 - frameThick/2, 0, 0);
    windowGroup.add(fRight);

    // 3분할 유리창
    const glassW = (winW - frameThick*2) / 3;
    const glassH = winH - frameThick*2;
    const glass1 = new THREE.Mesh(new THREE.BoxGeometry(glassW + 0.02, glassH, 0.03), matGlass);
    glass1.position.set(-glassW, 0, -0.02);
    windowGroup.add(glass1);
    const glass2 = new THREE.Mesh(new THREE.BoxGeometry(glassW + 0.02, glassH, 0.03), matGlass);
    glass2.position.set(0, 0, 0.02);
    windowGroup.add(glass2);
    const glass3 = new THREE.Mesh(new THREE.BoxGeometry(glassW + 0.02, glassH, 0.03), matGlass);
    glass3.position.set(glassW, 0, -0.02);
    windowGroup.add(glass3);

    windowGroup.position.set(getWorldX(5560), winH/2 + 0.29, getWorldZ(2385) - 0.01);
    scene.add(windowGroup);
    detailObjects.push(windowGroup);

    // 6. 벽면 장치 이식
    // 6.1 인터폰 & 스마트 스위치 개별 실측 부착 (서측 아트월 벽 X=3760, Z=6095 우측 끝 기준)
    // 6.1.1 인터폰 (우측 끝에서 왼쪽 끝단까지 41cm, Z = 5785, Y = 1.39m)
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.14, 0.006), matBlack);
    pad.position.set(getWorldX(3760) + 0.003, 1.39, getWorldZ(5785));
    pad.rotation.y = Math.PI / 2;
    scene.add(pad);
    pad.name = "living_intercom";
    detailObjects.push(pad);

    // 6.1.2 스마트 스위치 (우측 끝에서 왼쪽 끝단까지 35cm, Z = 5805, Y = 1.16m, 세로 높이 12cm)
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.006), matBlack);
    sw.position.set(getWorldX(3760) + 0.003, 1.16, getWorldZ(5805));
    sw.rotation.y = Math.PI / 2;
    scene.add(sw);
    sw.name = "living_smart_switch";
    detailObjects.push(sw);

    // 6.2 중앙 2단 콘센트/단자함 (서측 아트월 벽 X=3760, Z=4405 지점 실측 보정)
    // 12x12cm 중간 콘센트
    const outletTop = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.005), matWhite);
    outletTop.position.set(getWorldX(3760) + 0.003, 0.89, getWorldZ(4405));
    outletTop.rotation.y = Math.PI / 2;
    scene.add(outletTop);
    detailObjects.push(outletTop);

    // 24x12cm 하단 콘센트
    const outletBottom = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.005), matGray);
    outletBottom.position.set(getWorldX(3760) + 0.003, 0.49, getWorldZ(4405));
    outletBottom.rotation.y = Math.PI / 2;
    scene.add(outletBottom);
    detailObjects.push(outletBottom);

    // 6.3 동측 실크 벽지 벽(X=7360) 하단 콘센트 2개소 (Z=2995, Z=5595)
    const createEastOutlet = (z) => {
        const outlet = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.005), matGray);
        outlet.position.set(getWorldX(7360) - 0.003, 0.3, getWorldZ(z));
        outlet.rotation.y = -Math.PI / 2;
        scene.add(outlet);
        detailObjects.push(outlet);
    };
    createEastOutlet(2995);
    createEastOutlet(5595);

    // 7. 걸레받이 추가
    const createSkirting = (xStart, xEnd, z) => {
        const len = (xEnd - xStart) * MM_TO_UNIT;
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.01), matSkirting);
        skirt.position.set(getWorldX(xStart + (xEnd-xStart)/2), 0.03, getWorldZ(z) - wallT2/2 - 0.005);
        scene.add(skirt);
        detailObjects.push(skirt);
    };
    createSkirting(3760, 4210, 2495);
    createSkirting(6910, 7360, 2495);
    
    const skirtE_silk = new THREE.Mesh(new THREE.BoxGeometry(3.60, 0.06, 0.01), matSkirting);
    skirtE_silk.rotation.y = Math.PI / 2;
    skirtE_silk.position.set(getWorldX(7360) - 0.005, 0.03, getWorldZ(2495 + 1800));
    scene.add(skirtE_silk);
    detailObjects.push(skirtE_silk);

    const skirtW_art = new THREE.Mesh(new THREE.BoxGeometry(3.60, 0.02, 0.005), matSkirting);
    skirtW_art.rotation.y = Math.PI / 2;
    skirtW_art.position.set(getWorldX(3760) + 0.003, 0.01, getWorldZ(2495 + 1800));
    scene.add(skirtW_art);
    detailObjects.push(skirtW_art);
 
    // --- 거실 우물천장(Cove Ceiling) 상세 입체화 및 2구 전등 구현 ---
    const coveGroup = new THREE.Group();
    coveGroup.name = "living_cove_ceiling";

    // 1. 우물천장 안쪽 천장판 (Y = 2.4m 지점)
    const covePlateGeo = new THREE.BoxGeometry(2.4, 0.01, 2.4);
    const covePlate = new THREE.Mesh(covePlateGeo, matWhite);
    covePlate.position.set(getWorldX(5560), 2.4, getWorldZ(4295));
    coveGroup.add(covePlate);

    // 2. 우물천장 4면 세로 단차벽 (높이 10cm, Y = 2.35m 중심)
    const cWallMat = new THREE.MeshStandardMaterial({ color: 0xfcfcfc, roughness: 0.8 });
    
    // 남측 단차벽
    const cwSouth = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.02), cWallMat);
    cwSouth.position.set(getWorldX(5560), 2.35, getWorldZ(3095));
    coveGroup.add(cwSouth);
    // 북측 단차벽
    const cwNorth = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.02), cWallMat);
    cwNorth.position.set(getWorldX(5560), 2.35, getWorldZ(5495));
    coveGroup.add(cwNorth);
    // 서측 단차벽
    const cwWest = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 2.4), cWallMat);
    cwWest.position.set(getWorldX(4360), 2.35, getWorldZ(4295));
    coveGroup.add(cwWest);
    // 동측 단차벽
    const cwEast = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 2.4), cWallMat);
    cwEast.position.set(getWorldX(6760), 2.35, getWorldZ(4295));
    coveGroup.add(cwEast);

    // 3. 우물천장 구멍 하단 가장자리 테두리 몰딩 바 (폭 5cm, 두께 5mm, Y = 2.3m 중심)
    // 남측 몰딩
    const cmSouth = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.005, 0.05), matWhite);
    cmSouth.position.set(getWorldX(5560), 2.3, getWorldZ(3095));
    coveGroup.add(cmSouth);
    // 북측 몰딩
    const cmNorth = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.005, 0.05), matWhite);
    cmNorth.position.set(getWorldX(5560), 2.3, getWorldZ(5495));
    coveGroup.add(cmNorth);
    // 서측 몰딩
    const cmWest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.005, 2.4), matWhite);
    cmWest.position.set(getWorldX(4360), 2.3, getWorldZ(4295));
    coveGroup.add(cmWest);
    // 동측 몰딩
    const cmEast = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.005, 2.4), matWhite);
    cmEast.position.set(getWorldX(6760), 2.3, getWorldZ(4295));
    coveGroup.add(cmEast);

    // 4. 2구 슬림 사각형 LED 전등 조립 (Y = 2.39m에 밀착 부착)
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ledFrameMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
    
    const buildLEDUnit = (zCoord) => {
        const ledUnit = new THREE.Group();
        // LED 발광부 (아래쪽 얇은 박스)
        const lightMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.015, 0.25), ledMat);
        lightMesh.position.set(0, -0.0025, 0);
        ledUnit.add(lightMesh);
        // 등기구 프레임 (윗면/측면 엣지 테두리)
        const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(0.71, 0.02, 0.26), ledFrameMat);
        ledUnit.add(frameMesh);
        
        ledUnit.position.set(getWorldX(5560), 2.39, getWorldZ(zCoord));
        coveGroup.add(ledUnit);
    };
    // Z축으로 나란히 2구 배치 (중심 4295 기준 남북으로 15cm씩 오프셋)
    buildLEDUnit(4145); // 북쪽 등
    buildLEDUnit(4445); // 남쪽 등

    scene.add(coveGroup);
    detailObjects.push(coveGroup);
    roomWalls.push(coveGroup);

    // 거실 메인 전등 광원 신설 (높이 Y=2.25m, 중심 Z=4295로 정합 보정)
    const livingLight = new THREE.PointLight(0xfffdf4, 0.15, 12);
    livingLight.position.set(getWorldX(5560), 2.25, getWorldZ(4295));
    livingLight.castShadow = true;
    livingLight.shadow.bias = -0.0002;
    scene.add(livingLight);
    detailObjects.push(livingLight);
    
    // 거실 로컬 조명 등록
    window.appLights.living = [{ obj: livingLight, defaultVal: 0.15 }];
}

// --- 안방 실사 정밀 렌더링 알고리즘 ---
function buildBedroom1Details() {
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xfcfcfc, roughness: 0.8, metalness: 0.05 });
    const matBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.1 });
    const matGray = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.5, metalness: 0.3 }); // 콘센트 그레이
    const matGlass = new THREE.MeshStandardMaterial({ color: 0xb2cdd4, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.35 });
    const matSkirting = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.9, metalness: 0.02 }); // 걸레받이
    const matPost = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.8 }); // 시스템 기둥 (은색)
    const matShelf = new THREE.MeshStandardMaterial({ color: 0xf5f3ee, roughness: 0.85, metalness: 0.02 }); // 선반 (크림화이트)
    const matDiff = new THREE.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.9, metalness: 0.02 }); // 천장 디퓨저 재질
    const wallT2 = 220 * MM_TO_UNIT; // 내벽
    const skirtThick = 0.01;
    const skirtHeight = 0.06;

    // 1. 안방 천장 정사각형 단일 LED 조명 & 포인트 광원
    const lightGroup = new THREE.Group();
    const ledGeo = new THREE.BoxGeometry(0.6, 0.05, 0.6);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ledMesh = new THREE.Mesh(ledGeo, ledMat);
    lightGroup.add(ledMesh);

    // 안방 중앙 위치: X = 1890, Z = 4452.5 (Z: 5797.5 -> 4452.5)
    lightGroup.position.set(getWorldX(1890), 2.275, getWorldZ(4452.5));
    
    const roomLight = new THREE.PointLight(0xfffdf6, 0.15, 12); // 조도 0.35에서 0.15로 하향하여 과노출 방지
    roomLight.position.set(0, -0.15, 0);
    roomLight.castShadow = true;
    roomLight.shadow.bias = -0.0002;
    lightGroup.add(roomLight);
    
    // 안방 로컬 조명 등록
    window.appLights.bedroom1.push({ obj: roomLight, defaultVal: 0.15 });

    scene.add(lightGroup);
    detailObjects.push(lightGroup);

    // 2. 안방 시스템 에어컨 (남측 창문 부근 천장 Z = 3035) (Z: 4380 -> 3035)
    const acGroup = new THREE.Group();
    const acBody = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.45), matWhite);
    acGroup.add(acBody);
    const acBlade = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.005, 0.08), matGray);
    acBlade.position.set(0, -0.008, 0.1);
    acGroup.add(acBlade);
    
    acGroup.position.set(getWorldX(1890), 2.29, getWorldZ(3035));
    scene.add(acGroup);
    detailObjects.push(acGroup);

    const createCeilingDiffuser = (x, z) => {
        const diffGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.01, 24);
        const diffMesh = new THREE.Mesh(diffGeo, matDiff);
        diffMesh.position.set(getWorldX(x), 2.295, getWorldZ(z));
        scene.add(diffMesh);
        detailObjects.push(diffMesh);
    };
    createCeilingDiffuser(1890 - 800, 3035);
    createCeilingDiffuser(1890 + 800, 3035);

    // 3. 안방 방문 및 문틀 무광 블랙 레버 손잡이 (Z=6055 내벽면 상) (Z: 7415 -> 6055)
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, 0.08), matWhite);
    doorFrame.position.set(getWorldX(2480), 1.05, getWorldZ(6055));
    scene.add(doorFrame);
    detailObjects.push(doorFrame);

    const bedroom1DoorPivot = new THREE.Group();
    const pivotX = 3510;
    bedroom1DoorPivot.position.set(getWorldX(pivotX), 0, getWorldZ(6055));
    bedroom1DoorPivot.rotation.y = Math.PI / 2; 
    
    const doorWidth = 1.00;
    const doorPanelGeo = new THREE.BoxGeometry(doorWidth, 2.1, 0.04);
    const doorPanel = new THREE.Mesh(doorPanelGeo, matWhite);
    doorPanel.position.set(-doorWidth / 2, 1.05, 0); 
    bedroom1DoorPivot.add(doorPanel);
    
    const handleGroup = new THREE.Group();
    const rosette = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.006, 16), matBlack);
    rosette.rotation.x = Math.PI / 2;
    handleGroup.add(rosette);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.04), matBlack);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0, 0, 0.02);
    handleGroup.add(bar);
    
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.02), matBlack);
    lever.position.set(-0.05, 0, 0.04);
    handleGroup.add(lever);

    handleGroup.position.set(-doorWidth / 2 + 0.07, -0.05, 0.025);
    doorPanel.add(handleGroup);
    
    const handleBack = handleGroup.clone();
    handleBack.position.z = -0.025;
    handleBack.rotation.y = Math.PI;
    doorPanel.add(handleBack);
    
    scene.add(bedroom1DoorPivot);
    detailObjects.push(bedroom1DoorPivot);
    roomWalls.push(bedroom1DoorPivot);

    // 4. 드레스룸 양개형 중문 (Z: 6055)
    const doorFrameGroup = new THREE.Group();
    const frameThick = 0.02;
    const frameDepth = 0.08;
    const fTop = new THREE.Mesh(new THREE.BoxGeometry(1.0, frameThick, frameDepth), matWhite);
    fTop.position.set(getWorldX(1280), 2.1 - frameThick/2, getWorldZ(6055)); // 1340 -> 1280
    doorFrameGroup.add(fTop);
    
    const fLeft = new THREE.Mesh(new THREE.BoxGeometry(frameThick, 2.1, frameDepth), matWhite);
    fLeft.position.set(getWorldX(780) + frameThick/2, 1.05, getWorldZ(6055)); // 840 -> 780
    doorFrameGroup.add(fLeft);
    
    const fRight = new THREE.Mesh(new THREE.BoxGeometry(frameThick, 2.1, frameDepth), matWhite);
    fRight.position.set(getWorldX(1780) - frameThick/2, 1.05, getWorldZ(6055)); // 1840 -> 1780
    doorFrameGroup.add(fRight);
    
    scene.add(doorFrameGroup);
    detailObjects.push(doorFrameGroup);

    const doubleDoorL = new THREE.Group();
    doubleDoorL.position.set(getWorldX(780), 0, getWorldZ(6055)); // 840 -> 780
    const leafL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.1, 0.03), matWhite);
    leafL.position.set(0.25, 1.05, 0.015);
    doubleDoorL.add(leafL);
    doubleDoorL.rotation.y = -Math.PI / 2; 
    scene.add(doubleDoorL);
    detailObjects.push(doubleDoorL);
    roomWalls.push(doubleDoorL);

    const doubleDoorR = new THREE.Group();
    doubleDoorR.position.set(getWorldX(1780), 0, getWorldZ(6055)); // 1840 -> 1780
    const leafR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.1, 0.03), matWhite);
    leafR.position.set(-0.25, 1.05, 0.015);
    doubleDoorR.add(leafR);
    doubleDoorR.rotation.y = Math.PI / 2; 
    scene.add(doubleDoorR);
    detailObjects.push(doubleDoorR);
    roomWalls.push(doubleDoorR);

    // 5. 전기 기기류 이식
    const switchGroup = new THREE.Group();
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.002), matBlack);
    sw.position.set(0, 0.5, 0.002);
    switchGroup.add(sw);
    const outletBelow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.002), matGray);
    outletBelow.position.set(0, -0.5, 0.002);
    switchGroup.add(outletBelow);

    switchGroup.position.set(getWorldX(2145), 0.8, getWorldZ(6055) - 0.003); // Z: 6195 -> 6055 (스위치는 안방 북벽에 배치)
    scene.add(switchGroup);
    detailObjects.push(switchGroup);

    // 5.2 안방 동측 벽(X=3540) 창가 하단 콘센트 (Z: 4577.5 -> 3100)
    const outletE = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.005), matGray);
    outletE.position.set(getWorldX(3540) - 0.003, 0.3, getWorldZ(3100));
    outletE.rotation.y = Math.PI / 2;
    scene.add(outletE);
    detailObjects.push(outletE);

    // 5.3 안방 서측 벽(X=240) 창가 하단 콘센트 (Z: 4577.5 -> 3100)
    const outletW = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.005), matGray);
    outletW.position.set(getWorldX(240) + 0.003, 0.3, getWorldZ(3100));
    outletW.rotation.y = -Math.PI / 2;
    scene.add(outletW);
    detailObjects.push(outletW);

    // 5.4 드레스룸 내부 격벽(X=2425) 하단 콘센트
    const outletDress = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.005), matGray);
    outletDress.position.set(getWorldX(2425) - 0.003, 0.3, getWorldZ(6700)); // 2480 -> 2425, 6900 -> 6700
    outletDress.rotation.y = -Math.PI / 2;
    scene.add(outletDress);
    detailObjects.push(outletDress);

    // 6. 드레스룸 ㄷ자형 시스템 행거 가구 배치 (서측 드레스룸 내벽 영역 X = 240 ~ 2315, Z = 6165 ~ 7170 안착)
    const hangerGroup = new THREE.Group();

    const addPost = (x, z) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.2, 8), matPost);
        post.position.set(getWorldX(x), 1.1, getWorldZ(z));
        hangerGroup.add(post);
    };

    const addShelf = (x, z, w_mm, d_mm, y) => {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(w_mm*MM_TO_UNIT, 0.02, d_mm*MM_TO_UNIT), matShelf);
        shelf.position.set(getWorldX(x), y, getWorldZ(z));
        hangerGroup.add(shelf);
    };

    const addRod = (x, z, len_mm, dir) => {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, len_mm*MM_TO_UNIT, 8), matPost);
        if (dir === 'x') {
            rod.rotation.z = Math.PI / 2;
        } else {
            rod.rotation.x = Math.PI / 2;
        }
        rod.position.set(getWorldX(x), 1.9, getWorldZ(z));
        hangerGroup.add(rod);
    };

    // 6.1 북측 벽면 시스템 행거 (실제는 드레스룸 남측 욕실벽인 Z = 6970에 배치)
    addPost(440, 6970);      // X=440, Z=6970
    addPost(1277.5, 6970);   // X=1277.5, Z=6970 (중앙)
    addPost(2115, 6970);     // X=2115, Z=6970
    const shelfY = [0.1, 1.0, 2.0];
    shelfY.forEach(y => {
        addShelf(1277.5, 6970, 1675, 400, y); // 1370 -> 1277.5, 7350 -> 6970, 가로폭 1860 -> 1675
    });
    addRod(1277.5, 6970, 1575, 'x'); // 가로봉 길이 1760 -> 1575

    // 6.2 서측 외벽면 시스템 행거 (기존 포스트 외벽 뚫고 나가던 것 안착 보정)
    addPost(440, 6250); // X=390 -> 440, Z=6150 -> 6250 (가벽 관통 차단)
    addPost(440, 6870); // X=390 -> 440, Z=7250 -> 6870 (남선반 관통 차단)
    shelfY.forEach(y => {
        addShelf(440, 6560, 400, 620, y); // X=440, Z=6560, 깊이 800 -> 620
    });
    addRod(440, 6560, 620, 'z');

    // 6.3 동측 격벽면 시스템 행거 (기존 포스트 복도 격벽 뚫고 나가던 것 안착 보정)
    addPost(2115, 6250); // X=2220 -> 2115, Z=6150 -> 6250
    addPost(2115, 6870); // X=2220 -> 2115, Z=7250 -> 6870
    shelfY.forEach(y => {
        addShelf(2115, 6560, 400, 620, y); // X=2115, Z=6560, 깊이 800 -> 620
    });
    addRod(2115, 6560, 620, 'z');

    scene.add(hangerGroup);
    detailObjects.push(hangerGroup);

    // 6.4 드레스룸 내부 천장 매립 조명 & 디퓨저 환기구 (Z좌표 수축 연동)
    const dressCeilingLight = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.01, 0.15), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    dressCeilingLight.position.set(getWorldX(1277.5), 2.295, getWorldZ(6610)); // 1300 -> 1277.5, 6700 -> 6610
    scene.add(dressCeilingLight);
    detailObjects.push(dressCeilingLight);

    const dressLightSource = new THREE.PointLight(0xfffdf4, 0.1, 6); // 조도 0.25에서 0.1로 하향
    dressLightSource.position.set(getWorldX(1277.5), 2.1, getWorldZ(6610)); // 1300 -> 1277.5, 6700 -> 6610
    scene.add(dressLightSource);
    detailObjects.push(dressLightSource);
    
    // 드레스룸 로컬 조명 등록
    window.appLights.dressroom.push({ obj: dressLightSource, defaultVal: 0.1 });

    const dressDiff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 24), matDiff);
    dressDiff.position.set(getWorldX(1277.5), 2.295, getWorldZ(6870)); // 1300 -> 1277.5, 7150 -> 6870
    scene.add(dressDiff);
    detailObjects.push(dressDiff);

    // 7. 걸레받이 마감 조립
    // 안방 남측 걸레받이 (X=240~3540, Z: 4330 -> 2960)
    const skirtS = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.06, 0.01), matSkirting);
    skirtS.position.set(getWorldX(1890), 0.03, getWorldZ(2960) - skirtThick/2);
    scene.add(skirtS);
    detailObjects.push(skirtS);

    // 안방 북측 걸레받이 (Z: 6195 -> 6055)
    // 좌측 가벽 (X = 240 ~ 840)
    const skirtNW = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.01), matSkirting);
    skirtNW.position.set(getWorldX(540), 0.03, getWorldZ(6055) + wallT2/2 + 0.005);
    scene.add(skirtNW);
    detailObjects.push(skirtNW);

    // 중간 가벽 (X = 1840 ~ 2450, 폭 61cm)
    const skirtNE = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.06, 0.01), matSkirting);
    skirtNE.position.set(getWorldX(2145), 0.03, getWorldZ(6055) + wallT2/2 + 0.005);
    scene.add(skirtNE);
    detailObjects.push(skirtNE);
}

// --- 주방 빌트인 고정 가구 조립 알고리즘 (선택/조작 잠금 고정형) ---
function buildKitchenDetails() {
    window.appLights.kitchen = [];
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.85, metalness: 0.02 });
    const matCabinetInner = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.9, metalness: 0.01 }); // 장 내부 웜그레이
    const matMarble = new THREE.MeshStandardMaterial({ color: 0xf3f3f3, roughness: 0.35, metalness: 0.05 });
    const matBlack = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.4 });
    const matSteel = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.25, metalness: 0.8 });
    const matGlass = new THREE.MeshStandardMaterial({ color: 0xb2cdd4, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.35 });
    const matSkirting = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.9, metalness: 0.02 });

    const wallT2 = 220 * MM_TO_UNIT;

    // 주방 디테일 내 중복 터닝도어 코드는 삭제하고 발코니2 디테일로 일원화함

    // --- 수납장(Cabinet) 바디 및 도어 조립 함수 (칸칸이 구분) ---
    // 힌지 방향: 'left' 또는 'right', 또는 닫힘 'none'
    function buildCabinetUnit(parentGroup, startVal, endVal, depth, height, elev, isZAxis, hingeDir, openAngle, isUpper = false, shelvesCount = 1, isSinkBowl = false) {
        const width = Math.abs(endVal - startVal) * MM_TO_UNIT;
        const d = depth * MM_TO_UNIT;
        const h = height * MM_TO_UNIT;
        const el = elev * MM_TO_UNIT;
        
        const cabGroup = new THREE.Group();
        
        // 1. 바디 프레임 (Carcass) - 웜그레이
        const thick = 0.015; // 판넬 두께 15mm
        
        // 뒷판 (가구 뒤쪽) - Z축 정렬장일 경우 Z축 크기를 width로 설정하고 X좌표를 동쪽(+d/2)으로 밀착
        const backPanel = new THREE.Mesh(new THREE.BoxGeometry(isZAxis ? thick : width, h - thick*2, isZAxis ? width : thick), matCabinetInner);
        const backZ = isZAxis ? 0 : -(d/2 - thick/2);
        const backX = isZAxis ? (d/2 - thick/2) : 0;
        backPanel.position.set(backX, h/2, backZ);
        cabGroup.add(backPanel);
        
        // 좌판 & 우판 - Z축 정렬장일 경우 Z축 상에서 가구 너비(width) 기준으로 남쪽/북쪽 끝에 배치
        const leftPanel = new THREE.Mesh(new THREE.BoxGeometry(isZAxis ? d - thick : thick, h, isZAxis ? thick : d - thick), matCabinetInner);
        const leftZ = isZAxis ? -(width/2 - thick/2) : 0;
        const leftX = isZAxis ? 0 : -(width/2 - thick/2);
        leftPanel.position.set(leftX, h/2, leftZ);
        cabGroup.add(leftPanel);
        
        const rightPanel = new THREE.Mesh(new THREE.BoxGeometry(isZAxis ? d - thick : thick, h, isZAxis ? thick : d - thick), matCabinetInner);
        const rightZ = isZAxis ? (width/2 - thick/2) : 0;
        const rightX = isZAxis ? 0 : width/2 - thick/2;
        rightPanel.position.set(rightX, h/2, rightZ);
        cabGroup.add(rightPanel);
        
        // 상판 & 하판 (싱크볼 아래가 아니면 하판 배치, 상부장은 상하판 다 배치)
        if (!isSinkBowl || isUpper) {
            const bottomPanel = new THREE.Mesh(new THREE.BoxGeometry(isZAxis ? d - thick*2 : width - thick*2, thick, isZAxis ? width - thick*2 : d - thick*2), matCabinetInner);
            bottomPanel.position.set(0, thick/2, 0);
            cabGroup.add(bottomPanel);
        }
        
        const topPanel = new THREE.Mesh(new THREE.BoxGeometry(isZAxis ? d - thick*2 : width - thick*2, thick, isZAxis ? width - thick*2 : d - thick*2), matCabinetInner);
        topPanel.position.set(0, h - thick/2, 0);
        cabGroup.add(topPanel);
        
        // 2. 내부 선반 (Shelves)
        if (!isSinkBowl) {
            for (let i = 1; i <= shelvesCount; i++) {
                const shelfY = (h / (shelvesCount + 1)) * i;
                const shelfGeo = new THREE.BoxGeometry(
                    isZAxis ? d - thick*3 : width - thick*2 - 0.004,
                    0.015,
                    isZAxis ? width - thick*2 - 0.004 : d - thick*3
                );
                const shelf = new THREE.Mesh(shelfGeo, matCabinetInner);
                shelf.position.set(0, shelfY, 0);
                cabGroup.add(shelf);
            }
        }
        
        // 3. 도어 패널 및 힌지 (피벗)
        const doorPivot = new THREE.Group();
        const doorW = width - 0.003;
        const doorH = h - 0.003;
        const doorT = 0.018;
        
        // 힌지 위치 설정
        let pivotX = 0;
        let pivotZ = 0;
        let doorPosX = 0;
        let doorPosZ = 0;
        
        if (isZAxis) {
            // Z축 방향 가구 (우측 싱크대 라인) - 문은 서쪽(-X)을 향해 닫힘
            pivotX = -(d/2);
            doorPosX = -doorT/2;
            
            if (hingeDir === 'left') { // Z축 상에서는 북쪽(오른쪽)이 문 힌지선
                pivotZ = width/2;
                doorPosZ = -doorW/2;
            } else if (hingeDir === 'right') { // 남쪽(왼쪽)이 문 힌지선
                pivotZ = -width/2;
                doorPosZ = doorW/2;
            } else {
                pivotZ = 0;
                doorPosZ = 0;
            }
        } else {
            // X축 방향 가구 (북쪽 싱크대 라인) - 문은 남쪽(-Z)을 향해 닫힘
            pivotZ = d/2;
            doorPosZ = doorT/2;
            
            if (hingeDir === 'left') { // X축 상에서는 왼쪽(-X)이 문 힌지선
                pivotX = -width/2;
                doorPosX = doorW/2;
            } else if (hingeDir === 'right') { // 오른쪽(+X)이 문 힌지선
                pivotX = width/2;
                doorPosX = -doorW/2;
            } else {
                pivotX = 0;
                doorPosX = 0;
            }
        }
        
        doorPivot.position.set(pivotX, 0, pivotZ);
        
        if (hingeDir !== 'none') {
            const doorGeo = new THREE.BoxGeometry(
                isZAxis ? doorT : doorW,
                doorH,
                isZAxis ? doorW : doorT
            );
            const door = new THREE.Mesh(doorGeo, matWhite);
            door.position.set(doorPosX, h/2, doorPosZ);
            doorPivot.add(door);
            
            // 회전각 적용 (열림 상태 구현)
            if (hingeDir === 'left') {
                doorPivot.rotation.y = -openAngle;
            } else if (hingeDir === 'right') {
                doorPivot.rotation.y = openAngle;
            }
        }
        cabGroup.add(doorPivot);
        
        // 월드 좌표 배치
        const midVal = (startVal + endVal) / 2;
        const posX = isZAxis ? getWorldX(7000 - depth/2) : getWorldX(midVal);
        const posZ = isZAxis ? getWorldZ(midVal) : getWorldZ(11050 - depth/2);
        cabGroup.position.set(posX, el, posZ);
        
        parentGroup.add(cabGroup);
    }

    // 싱크대 마스터 그룹
    const kitchenG = new THREE.Group();

    // 2. 하부 걸레받이 마감 (Skirting) - 높이 120mm
    // 북쪽 가로 하부 걸레받이 (X = 3650 ~ 7000, Z = 10350 ~ 11050 영역, 걸레받이는 50mm 뒤로 밀림)
    const skirtL = 3.24; // 3.24m (3760부터 7000까지 주방 하단을 덮도록 보정)
    const skirtN = new THREE.Mesh(new THREE.BoxGeometry(skirtL, 0.12, 0.02), matSkirting);
    skirtN.position.set(getWorldX(3760 + skirtL/2), 0.06, getWorldZ(10350 + 50)); // 2번 걸레받이의 발코니2 침범 방지 및 우측 끝선 마감
    kitchenG.add(skirtN);
    
    // 우측 세로 하부 걸레받이 (Z = 8950 ~ 10350 영역, 걸레받이는 50mm 안으로 밀림)
    const skirtR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 1.4), matSkirting);
    skirtR.position.set(getWorldX(7000 - 50), 0.06, getWorldZ(9650));
    kitchenG.add(skirtR);

    // 3. 인조대리석 상판 조립 (Y = 0.83 ~ 0.85)
    // 3.1 북쪽 가로 상판 (X = 3760 ~ 7000, 깊이 700, 두께 20) -> 발코니2 턱 삐져나옴 소거를 위해 시작점을 X=3760으로 보정
    const topN = new THREE.Mesh(new THREE.BoxGeometry(3.24, 0.02, 0.7), matMarble);
    topN.position.set(getWorldX(3760 + 3240/2), 0.84, getWorldZ(11050 - 350));
    kitchenG.add(topN);
    
    // 3.2 우측 세로 상판 (Z = 8950 ~ 10350, 가로폭 700, 두께 20)
    const topR = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 1.4), matMarble);
    topR.position.set(getWorldX(7000 - 350), 0.84, getWorldZ(8950 + 1400/2));
    kitchenG.add(topR);

    // 매립형 찬넬 손잡이 은색 알루미늄 홈 데코 (대리석 상판 바로 밑에 얇은 선으로 표현) -> 시작점을 X=3760으로 보정
    const channelN = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.03, 0.01), matSteel);
    channelN.position.set(getWorldX(3760 + 2550/2), 0.815, getWorldZ(10350 - 5));
    kitchenG.add(channelN);
    
    const channelR = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 1.4), matSteel);
    channelR.position.set(getWorldX(7000 - 5), 0.815, getWorldZ(9650));
    kitchenG.add(channelR);

    // --- 4. 북쪽벽 하단 가구 (하부장) 개별 분할 조립 (Y = 0.12 ~ 0.83, 높이 710mm, 깊이 700mm) ---
    // 1번 도어 (폭 45cm): 닫힘 (0도) -> 발코니2 턱 삐져나옴 해결을 위해 시작점을 X=3760으로 밀기
    buildCabinetUnit(kitchenG, 3760, 4210, 700, 710, 120, false, 'left', 0, false, 1);
    // 2번 도어 (폭 55cm, 싱크볼 하부 좌): 닫힘 (0도), 싱크볼 수납장 설정으로 하판 뚫림
    buildCabinetUnit(kitchenG, 4210, 4760, 700, 710, 120, false, 'left', 0, false, 0, true);
    // 3번 도어 (폭 55cm, 싱크볼 하부 우): 닫힘 (0도)
    buildCabinetUnit(kitchenG, 4760, 5310, 700, 710, 120, false, 'right', 0, false, 0, true);
    // 4번 도어 (폭 60cm): 닫힘
    buildCabinetUnit(kitchenG, 5310, 5910, 700, 710, 120, false, 'left', 0, false, 1);
    // 5번 도어 (폭 40cm): 닫힘
    buildCabinetUnit(kitchenG, 5910, 6310, 700, 710, 120, false, 'left', 0, false, 1);
    // 필러 마감 (폭 10cm): 3번 버그(마지막 필러 문 없음) 해결을 위해 힌지 방향을 'left'로 설정하여 문짝 장착
    buildCabinetUnit(kitchenG, 6310, 6410, 700, 710, 120, false, 'left', 0, false, 1);
    
    // 코너마감 하부장 영역 (700x700, X = 6300 ~ 7000): 문 없음
    const cornerCabGeo = new THREE.BoxGeometry(0.7, 0.71, 0.7);
    const cornerCab = new THREE.Mesh(cornerCabGeo, matCabinetInner);
    cornerCab.position.set(getWorldX(6650), 0.12 + 0.71/2, getWorldZ(10700));
    kitchenG.add(cornerCab);

    // 싱크볼 매립 개수대 (X = 4300 ~ 5200 부근, 창문 중앙 배치)
    const sinkBowl = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.002, 0.45), matSteel);
    sinkBowl.position.set(getWorldX(4750), 0.851, getWorldZ(11050 - 350));
    kitchenG.add(sinkBowl);
    
    // 개수대 안쪽 배관 묘사 (문이 열렸을 때 들여다보이도록 간략하게 묘사)
    const pipeGroup = new THREE.Group();
    const pipeMain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.25), matSteel);
    pipeMain.position.set(getWorldX(4750), 0.5, getWorldZ(11050 - 350));
    pipeGroup.add(pipeMain);
    const pipeDrain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3), matSteel);
    pipeDrain.position.set(getWorldX(4750), 0.3, getWorldZ(11050 - 250));
    pipeDrain.rotation.x = Math.PI / 3;
    pipeGroup.add(pipeDrain);
    kitchenG.add(pipeGroup);

    // 입체 거위목 수전
    const tapGroup = new THREE.Group();
    const tapBase = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1), matSteel);
    tapBase.position.y = 0.05;
    tapGroup.add(tapBase);
    
    const tapNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.25), matSteel);
    tapNeck.position.set(0, 0.2, 0.05);
    tapNeck.rotation.x = 0.3;
    tapGroup.add(tapNeck);
    
    tapGroup.position.set(getWorldX(4750), 0.85, getWorldZ(11050 - 150));
    kitchenG.add(tapGroup);

    // --- 5. 북쪽벽 상단 가구 (상부장) 개별 분할 조립 (Y = 1.30 ~ 2.00, 높이 700mm, 깊이 350mm) ---
    // 5.1 좌측 상부장L (폭 39cm, X = 3760 ~ 4150): 시작점 X=3760으로 보정 및 창문 가림 방지를 위해 폭 39cm로 정합
    buildCabinetUnit(kitchenG, 3760, 4150, 350, 700, 1300, false, 'left', 0, true, 2);
    
    // 좌측 상부 몰딩 등박스 마감 (30cm 높이, 폭 39cm)
    const upperMoldL = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.3, 0.35), matWhite);
    upperMoldL.position.set(getWorldX(3760 + 390/2), 2.0 + 0.15, getWorldZ(11050 - 175));
    kitchenG.add(upperMoldL);

    // 5.2 우측 상부장R (폭 133cm, X = 5350 ~ 6680):
    // 3짝 도어로 나누어 조립 (각각 폭 약 44.3cm)
    // 1번째 문 (좌): 닫힘 (0도)
    buildCabinetUnit(kitchenG, 5350, 5793, 350, 700, 1300, false, 'left', 0, true, 2);
    // 2번째 문 (중): 닫힘 (0도)
    buildCabinetUnit(kitchenG, 5793, 6236, 350, 700, 1300, false, 'right', 0, true, 2);
    // 3번째 문 (우): 닫힘
    buildCabinetUnit(kitchenG, 6236, 6680, 350, 700, 1300, false, 'left', 0, true, 2);

    const upperMoldR = new THREE.Mesh(new THREE.BoxGeometry(1.33, 0.3, 0.35), matWhite);
    upperMoldR.position.set(getWorldX(6015), 2.0 + 0.15, getWorldZ(11050 - 175));
    kitchenG.add(upperMoldR);

    // 5.3 상부장 코너마감 영역 (320x350, X = 6680 ~ 7000): 닫힘
    buildCabinetUnit(kitchenG, 6680, 7000, 350, 700, 1300, false, 'none', 0, true, 2);
    
    const upperMoldC = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.35), matWhite);
    upperMoldC.position.set(getWorldX(6840), 2.0 + 0.15, getWorldZ(11050 - 175));
    kitchenG.add(upperMoldC);

    // --- 6. 우측벽 하단 가구 (싱크대 세로 연장부) 조립 (X = 6300 ~ 7000, Y = 0.12 ~ 0.83, 깊이 700mm) ---
    // 코너마감 하부장 (70cm = 700mm, Z = 10350 ~ 11050): 위에 중복 배치 방지를 위해 뺌
    
    // 하단장1 (20cm 망장, Z = 10150 ~ 10350): 닫힘
    buildCabinetUnit(kitchenG, 10150, 10350, 700, 710, 120, true, 'left', 0, false, 1);
    
    // 하단장2 (60cm 일반 화이트 도어 수납장, Z = 9550 ~ 10150): 실제 사진에 오븐이 없으므로 일반 수납장으로 대체
    buildCabinetUnit(kitchenG, 9550, 10150, 700, 710, 120, true, 'left', 0, false, 1);

    // 빌트인 인덕션 쿡탑 (아일랜드 세로 상판 위에 매립, Z = 9850 중심)
    const cookTop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.002, 0.6), matBlack);
    cookTop.position.set(getWorldX(7000 - 350), 0.851, getWorldZ(9850));
    kitchenG.add(cookTop);

    // 하단장3 (30cm 일반 수납장, Z = 9250 ~ 9550):
    // -> 사용자의 피드백 및 실물 사진 일치 반영: 오픈형 밥솥장 대신 전체 높이를 덮는 화이트 수납장 문짝으로 복원하여 4번 버그(문 반절만 있음) 해결
    buildCabinetUnit(kitchenG, 9250, 9550, 700, 710, 120, true, 'left', 0, false, 1);

    // 하단장4 (30cm 일반 서랍/도어장, Z = 8950 ~ 9250): 닫힘
    buildCabinetUnit(kitchenG, 8950, 9250, 700, 710, 120, true, 'left', 0, false, 1);

    // --- 7. 우측벽 상단 가구 (상부장 및 후드) 조립 (X = 7000 밀착, Y = 1.30 ~ 2.00, 깊이 300mm) ---
    // 코너마감 상부장 (30cm = 300mm, Z = 10750 ~ 11050)
    buildCabinetUnit(kitchenG, 10750, 11050, 300, 700, 1300, true, 'none', 0, true, 2);
    
    // 상단장1 (45cm, Z = 10300 ~ 10750): 닫힘
    buildCabinetUnit(kitchenG, 10300, 10750, 300, 700, 1300, true, 'left', 0, true, 2);
    
    // 상단장2 (45cm 후드장, Z = 9850 ~ 10300): 
    // 하부에 블랙 슬림 후드 포인트 장착 (Y = 1.30 ~ 1.35)
    const hoodUpper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.65, 0.45), matWhite);
    hoodUpper.position.set(getWorldX(7000 - 150), 1.35 + 0.65/2, getWorldZ(10075));
    kitchenG.add(hoodUpper);
    
    // 후드 밑판 (상부장 깊이 300mm에 맞춰 X크기를 0.3으로 정합하고 X위치 7000-150으로 밀착 매립)
    const blackHood = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.45), matBlack);
    blackHood.position.set(getWorldX(7000 - 150), 1.3 + 0.025, getWorldZ(10075));
    kitchenG.add(blackHood);

    // 상단장3 (45cm, Z = 9400 ~ 9850): 닫힘
    buildCabinetUnit(kitchenG, 9400, 9850, 300, 700, 1300, true, 'left', 0, true, 2);
    
    // 상단장4 (45cm, Z = 8950 ~ 9400): 닫힘
    buildCabinetUnit(kitchenG, 8950, 9400, 300, 700, 1300, true, 'left', 0, true, 2);
    
    // 우측 상부 몰딩 등박스 마감 (30cm 높이)
    const upperMoldEast = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.1), matWhite);
    upperMoldEast.position.set(getWorldX(7000 - 150), 2.0 + 0.15, getWorldZ(10000));
    kitchenG.add(upperMoldEast);

    // --- 8. 우측 냉장고장 및 마감 격벽 (Z = 7930 ~ 8950) ---
    // 8.1 냉장고장 슬롯 및 상부 플랩장 (Z = 7900 ~ 8950, 폭 1050mm, X축 깊이 700mm)
    const fridgeBox = new THREE.Group();
    
    // 상부 2도어 플랩장 (높이 41cm, Y = 1.89 ~ 2.3) - 가로 2분할 묘사
    // 왼쪽 플랩 도어 (Z = 8425 ~ 8950)
    const fridgeTopL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.41, 0.018), matWhite);
    fridgeTopL.position.set(getWorldX(7000 - 350 - 5), 1.89 + 0.41/2, getWorldZ(8687.5));
    fridgeBox.add(fridgeTopL);
    
    // 오른쪽 플랩 도어 (Z = 7900 ~ 8425)
    const fridgeTopR = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.41, 0.018), matWhite);
    fridgeTopR.position.set(getWorldX(7000 - 350 - 5), 1.89 + 0.41/2, getWorldZ(8162.5));
    fridgeBox.add(fridgeTopR);
    
    // 플랩장 프레임 몸체 (Z축 폭 1050, X축 깊이 700, 높이 410)
    const fridgeTopBody = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.41, 1.03), matCabinetInner);
    fridgeTopBody.position.set(getWorldX(7000 - 350), 1.89 + 0.41/2, getWorldZ(8425));
    fridgeBox.add(fridgeTopBody);

    // 좌측 지지 벽판 (Z = 8950 경계면에 세로 판넬 세우기, 두께 20mm, 깊이 700mm, 높이 1.89m)
    const fridgeLeftPanel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.89, 0.02), matWhite);
    fridgeLeftPanel.position.set(getWorldX(7000 - 350), 1.89/2, getWorldZ(8950));
    fridgeBox.add(fridgeLeftPanel);
    
    // 냉장고 슬롯 안쪽 매립 2구 콘센트 부착 (Y = 0.3, Z = 8425 뒷벽)
    const fridgeOutlet = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.07, 0.12), matSteel);
    fridgeOutlet.position.set(getWorldX(7000) - 0.002, 0.3, getWorldZ(8425));
    fridgeBox.add(fridgeOutlet);

    kitchenG.add(fridgeBox);

    // 8.2 우측 마감 격벽 (Z = 7580 ~ 7900, 두께 320mm, 깊이 700mm, 높이 2.3m 천장 밀착)
    const fridgeRightWall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.3, 0.32), matWhite);
    fridgeRightWall.position.set(getWorldX(7000 - 350), 2.3/2, getWorldZ(7740));
    kitchenG.add(fridgeRightWall);

    // 8.3 세탁실 터닝도어 우측 가벽 콘센트 부착 (X = 3650, Z = 9060 중심 가벽라인 상의 X=4540 부근, Z=9060)
    // -> 사용자의 명시적 요청에 따라 주방 복도 한가운데 허공에 둥둥 뜨는 3번 검은 박스(콘센트)는 영구 제거 처리함.

    // 8.4 주방 북측 샷시 창문 3D 메쉬 신설 조립 (개수대 상부, X = 4150 ~ 5350)
    const windowGroup = new THREE.Group();
    const wFrameW = 1.2;
    const wFrameH = 1.2; // 사용자의 피드백을 반영하여 세로 높이를 120cm로 조정
    const wFrameThick = 0.04;
    const wFrameDepth = 0.12;
    
    // 외경 프레임 조립
    const wFrameTop = new THREE.Mesh(new THREE.BoxGeometry(wFrameW, wFrameThick, wFrameDepth), matWhite);
    wFrameTop.position.set(0, wFrameH/2 - wFrameThick/2, 0);
    windowGroup.add(wFrameTop);
    
    const wFrameBottom = new THREE.Mesh(new THREE.BoxGeometry(wFrameW, wFrameThick, wFrameDepth), matWhite);
    wFrameBottom.position.set(0, -wFrameH/2 + wFrameThick/2, 0);
    windowGroup.add(wFrameBottom);
    
    const wFrameLeft = new THREE.Mesh(new THREE.BoxGeometry(wFrameThick, wFrameH - wFrameThick*2, wFrameDepth), matWhite);
    wFrameLeft.position.set(-wFrameW/2 + wFrameThick/2, 0, 0);
    windowGroup.add(wFrameLeft);
    
    const wFrameRight = new THREE.Mesh(new THREE.BoxGeometry(wFrameThick, wFrameH - wFrameThick*2, wFrameDepth), matWhite);
    wFrameRight.position.set(wFrameW/2 - wFrameThick/2, 0, 0);
    windowGroup.add(wFrameRight);
    
    // 이중 슬라이딩 유리창 (2짝 엇갈림)
    const wGlassW = wFrameW / 2 + 0.01;
    const wGlassH = wFrameH - wFrameThick*2;
    
    const wGlass1 = new THREE.Mesh(new THREE.BoxGeometry(wGlassW, wGlassH, 0.02), matGlass);
    wGlass1.position.set(-wFrameW/4, 0, -0.02);
    windowGroup.add(wGlass1);
    
    const wGlass2 = new THREE.Mesh(new THREE.BoxGeometry(wGlassW, wGlassH, 0.02), matGlass);
    wGlass2.position.set(wFrameW/4, 0, 0.02);
    windowGroup.add(wGlass2);
    
    // 창문 위치: X = 4750 (개수대 중앙 정렬), Z = 11050 (북측벽 내면), Y = 2.2 - wFrameH/2 (천장 2.3m 기준 10cm 밑에서 시작하여 120cm 길이로 내려오도록 조정)
    windowGroup.position.set(getWorldX(4750), 2.2 - wFrameH/2, getWorldZ(11050) + wFrameDepth/2);
    scene.add(windowGroup);
    detailObjects.push(windowGroup);

    // 마스터 그룹 씬 추가
    scene.add(kitchenG);
    detailObjects.push(kitchenG);

    // --- 9. 천장 조명 배치 (실제 사진과 같이 가로 및 세로 배치 보정) ---
    const createSlimLight = (x, z) => {
        const lBox = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.015, 0.08), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        lBox.position.set(getWorldX(x), 2.292, getWorldZ(z));
        scene.add(lBox);
        detailObjects.push(lBox);
        
        const pLight = new THREE.PointLight(0xfffef0, 0.12, 8);
        pLight.position.set(getWorldX(x), 2.1, getWorldZ(z));
        scene.add(pLight);
        detailObjects.push(pLight);
        
        // 주방 로컬 조명 등록
        window.appLights.kitchen.push({ obj: pLight, defaultVal: 0.12 });
    };
    // 9.1 가로 엣지 조명 (개수대 위 천장)
    createSlimLight(4750, 10750); 
    
    // 9.2 세로 엣지 조명 (인덕션 위 천장, Z축 방향 세로형 배치)
    const lBoxVert = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lBoxVert.position.set(getWorldX(6650), 2.292, getWorldZ(9850));
    scene.add(lBoxVert);
    detailObjects.push(lBoxVert);
    
    const pLightVert = new THREE.PointLight(0xfffef0, 0.12, 8);
    pLightVert.position.set(getWorldX(6650), 2.1, getWorldZ(9850));
    scene.add(pLightVert);
    detailObjects.push(pLightVert);
    
    // 주방 로컬 조명 등록
    window.appLights.kitchen.push({ obj: pLightVert, defaultVal: 0.12 });

    // 3인치 매립 원형 다운라이트 2개로 축소 (기존 4개 ➡️ 2개)
    const createDownlight = (x, z) => {
        const dl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.005, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        dl.position.set(getWorldX(x), 2.297, getWorldZ(z));
        scene.add(dl);
        detailObjects.push(dl);
        
        const pl = new THREE.PointLight(0xfffdf4, 0.06, 6);
        pl.position.set(getWorldX(x), 2.1, getWorldZ(z));
        scene.add(pl);
        detailObjects.push(pl);
        
        // 주방 로컬 조명 등록
        window.appLights.kitchen.push({ obj: pl, defaultVal: 0.06 });
    };
    createDownlight(3800, 8500);
    createDownlight(5500, 8500);
}

// --- 발코니2 (다용도실 및 세탁실) 실사 정밀 렌더링 알고리즘 ---
function buildBalcony2Details() {
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xfcfcfc, roughness: 0.8, metalness: 0.05 });
    const matBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.1 });
    const matSteel = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.25, metalness: 0.8 });
    const matGray = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.5, metalness: 0.3 });
    const matGlass = new THREE.MeshStandardMaterial({ color: 0xb2cdd4, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.35 });
    
    // 발코니2 전용 타일 재질 (기존 타일 텍스처 재사용)
    let tileTex = floorTextures['tile'];
    let clonedTileTex = null;
    if (tileTex) {
        if (typeof tileTex.clone === 'function') {
            clonedTileTex = tileTex.clone();
        } else {
            clonedTileTex = tileTex;
        }
    }
    if (clonedTileTex) {
        if (clonedTileTex.repeat && typeof clonedTileTex.repeat.set === 'function') {
            clonedTileTex.repeat.set(2, 4);
        }
        clonedTileTex.needsUpdate = true;
    }
    const matTile = new THREE.MeshStandardMaterial({
        map: clonedTileTex,
        roughness: 0.8,
        metalness: 0.05
    });

    // 1. L자형 PS(파이프샤프트)실 기둥 구현
    // 위치: 북서측 코너 X = 1235 ~ 1835 (폭 600mm), Z = 10470 ~ 11170 (깊이 700mm)
    const psColGeo = new THREE.BoxGeometry(0.6, 2.3, 0.7);
    const psCol = new THREE.Mesh(psColGeo, matWhite);
    psCol.position.set(
        getWorldX((1235 + 1835) / 2),
        2.3 / 2,
        getWorldZ((10470 + 11170) / 2)
    );
    psCol.castShadow = true;
    psCol.receiveShadow = true;
    scene.add(psCol);
    detailObjects.push(psCol);

    // 2. 북측 외벽 샷시 창문 조립 (창폭 900mm, X = 2065 ~ 2965 창벽 구멍에 완벽 정합)
    const windowGroup = new THREE.Group();
    const winW = 0.9;
    const winH = 1.1; // 창문 높이 110cm
    const frameThick = 0.04;
    const frameDepth = 0.12;

    // 외경 프레임 조립
    const fTop = new THREE.Mesh(new THREE.BoxGeometry(winW, frameThick, frameDepth), matWhite);
    fTop.position.set(0, winH/2 - frameThick/2, 0);
    windowGroup.add(fTop);

    const fBottom = new THREE.Mesh(new THREE.BoxGeometry(winW, frameThick, frameDepth), matWhite);
    fBottom.position.set(0, -winH/2 + frameThick/2, 0);
    windowGroup.add(fBottom);

    const fLeft = new THREE.Mesh(new THREE.BoxGeometry(frameThick, winH - frameThick*2, frameDepth), matWhite);
    fLeft.position.set(-winW/2 + frameThick/2, 0, 0);
    windowGroup.add(fLeft);

    const fRight = new THREE.Mesh(new THREE.BoxGeometry(frameThick, winH - frameThick*2, frameDepth), matWhite);
    fRight.position.set(winW/2 - frameThick/2, 0, 0);
    windowGroup.add(fRight);

    // 슬라이딩 유리창 (2짝 엇갈림)
    const glassW = winW / 2 + 0.01;
    const glassH = winH - frameThick*2;
    const glass1 = new THREE.Mesh(new THREE.BoxGeometry(glassW, glassH, 0.02), matGlass);
    glass1.position.set(-winW/4, 0, -0.015);
    windowGroup.add(glass1);

    const glass2 = new THREE.Mesh(new THREE.BoxGeometry(glassW, glassH, 0.02), matGlass);
    glass2.position.set(winW/4, 0, 0.015);
    windowGroup.add(glass2);

    // 북측 벽선(Z = 11170) 내면에 밀착 배치 (창문 중심 X = 2515)
    windowGroup.position.set(
        getWorldX(2515), // 창문 중심 X (2065 ~ 2965 세그먼트의 중심)
        1.15 + winH/2,   // Y (창턱높이 1.15m + 절반 높이)
        getWorldZ(11170) + frameDepth/2 + 0.002
    );
    scene.add(windowGroup);
    detailObjects.push(windowGroup);

    // 3. 서측 높은 바닥 (원래 층고 Y=0 레벨) 구현
    // 위치: X = 1235 ~ 1835 (폭 600mm), Z = 9060 ~ 10470 (깊이 1410mm, 북서측 PS실 제외), 높이 50mm (낮아진 바닥 -5cm에서 5cm 올라옴)
    const stepHeight = 0.05;
    const stepGeo = new THREE.BoxGeometry(0.6, stepHeight, 1.41);
    const stepMesh = new THREE.Mesh(stepGeo, matTile);
    stepMesh.position.set(
        getWorldX((1235 + 1835) / 2),
        -0.05 + stepHeight / 2, // 상단 표면이 원래 층고 Y=0이 되도록 설정
        getWorldZ((9060 + 10470) / 2)
    );
    stepMesh.receiveShadow = true;
    stepMesh.castShadow = true;
    scene.add(stepMesh);
    detailObjects.push(stepMesh);

    // 3.1 배수구 (유가) 구현
    // 위치: 낮은 바닥(Y = -0.05) 공간의 남동측 부근 X = 2500, Z = 9400
    const drainGeo = new THREE.BoxGeometry(0.15, 0.002, 0.15);
    const drainMesh = new THREE.Mesh(drainGeo, matSteel);
    drainMesh.position.set(getWorldX(2500), -0.049, getWorldZ(9400)); // 낮은 바닥에 안착시키기 위해 Y = -0.049m 설정
    scene.add(drainMesh);
    detailObjects.push(drainMesh);

    // 3.2 세탁실 터닝도어 중문 유리문 조립 (X = 3650, Z = 9290 ~ 10210)
    const frameGroup = new THREE.Group();
    const doorFrameThick = 0.03;
    const doorFrameDepth = 0.08;
    
    // 문틀 조립
    const fTopDoor = new THREE.Mesh(new THREE.BoxGeometry(doorFrameThick, doorFrameThick, 0.92), matWhite);
    fTopDoor.position.set(getWorldX(3650), 2.1 - doorFrameThick/2, getWorldZ(9750));
    frameGroup.add(fTopDoor);
    
    const fSouthDoor = new THREE.Mesh(new THREE.BoxGeometry(doorFrameThick, 2.1, doorFrameThick), matWhite);
    fSouthDoor.position.set(getWorldX(3650), 1.05, getWorldZ(9290) - doorFrameThick/2);
    frameGroup.add(fSouthDoor);
    
    const fNorthDoor = new THREE.Mesh(new THREE.BoxGeometry(doorFrameThick, 2.1, doorFrameThick), matWhite);
    fNorthDoor.position.set(getWorldX(3650), 1.05, getWorldZ(10210) + doorFrameThick/2);
    frameGroup.add(fNorthDoor);
    
    scene.add(frameGroup);
    detailObjects.push(frameGroup);
    roomWalls.push(frameGroup);

    // 터닝도어 문짝 피벗 및 문판 (Z=9290 경첩, 안쪽인 세탁실 복도쪽(서쪽)으로 열림)
    const doorPivot = new THREE.Group();
    doorPivot.position.set(getWorldX(3650), 0, getWorldZ(9290));
    doorPivot.rotation.y = Math.PI * 0.35; // 양수 회전각을 적용하여 세탁실 방향(서쪽)으로 정상 개방
    
    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.1, 0.88), matWhite);
    doorPanel.position.set(0, 1.05, -0.44); // 로컬 Z축 음수(북쪽)로 뻗음
    doorPivot.add(doorPanel);
    
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.5, 0.58), matGlass);
    glass.position.set(0, 0.0, 0.0); // 1번(유리창 이탈) 및 2번(바닥의 찌꺼기 메쉬) 오류 해결을 위해 로컬 Z좌표를 0.0으로 보정
    doorPanel.add(glass);
    
    scene.add(doorPivot);
    detailObjects.push(doorPivot);
    roomWalls.push(doorPivot);

    // 4. 수도꼭지 (수전) 3구 조립 (남측 Z = 9060 라인 상에 밀착, 세탁실 안쪽 방향으로 돌출)
    const buildWaterTap = (x, y, z, colorHex, rotY = 0) => {
        const tapGroup = new THREE.Group();
        const tapMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3, metalness: 0.8 });
        
        // 수도관 연결부 (벽에서 돌출)
        const conn = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.05), tapMat);
        conn.rotation.z = Math.PI / 2;
        tapGroup.add(conn);

        // 수도꼭지 몸체
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06), tapMat);
        body.position.set(0.03, -0.02, 0);
        tapGroup.add(body);

        // 토수구 (물 나오는 곳)
        const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03), tapMat);
        spout.position.set(0.035, -0.045, 0);
        tapGroup.add(spout);

        // 손잡이 레버
        const lever = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.01, 0.015), tapMat);
        lever.position.set(0.02, 0.015, 0);
        tapGroup.add(lever);

        tapGroup.position.set(x, y, z);
        tapGroup.rotation.y = rotY; // 벽면 배치에 맞춰 Y축 회전 적용
        scene.add(tapGroup);
        detailObjects.push(tapGroup);
    };

    // 남측 벽면(Z = 9060, 벽 두께 220mm의 반폭 110mm 오프셋 적용하여 Z=9170 표면)에 냉/온수 수전 2구 (Y = 1.2m, X = 1530 및 1650)
    buildWaterTap(getWorldX(1530), 1.2, getWorldZ(9060 + 110) - 0.005, 0xdd1111, -Math.PI / 2); // 온수 수전 (적색 포인트, 벽체 두께 반영 돌출 보정)
    buildWaterTap(getWorldX(1650), 1.2, getWorldZ(9060 + 110) - 0.005, 0x1111dd, -Math.PI / 2); // 냉수 수전 (청색 포인트, 벽체 두께 반영 돌출 보정)
    // 하단 물청소용 수전 1구 (Y = 0.5m, X = 1590)
    buildWaterTap(getWorldX(1590), 0.5, getWorldZ(9060 + 110) - 0.005, 0x94a3b8, -Math.PI / 2); // 일반 스틸 수전 (벽체 두께 반영 돌출 보정)

    // 5. 가스계량기 및 배관 조립 (동측 X = 3650 벽면 터닝도어 북쪽 Z = 10500 부근)
    const meterGroup = new THREE.Group();
    const meterBody = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.12), matWhite);
    meterGroup.add(meterBody);

    // 계량기 전면 액정판
    const meterScreen = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.002), matBlack);
    meterScreen.position.set(0, 0.04, 0.061);
    meterGroup.add(meterScreen);

    // 가스관 파이프 라인 2개 (계량기 상단에서 솟아 벽으로 이어짐)
    const pipeL = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.15), matSteel);
    pipeL.position.set(-0.05, 0.15, 0);
    meterGroup.add(pipeL);

    const pipeR = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.15), matSteel);
    pipeR.position.set(0.05, 0.15, 0);
    meterGroup.add(pipeR);

    // Y = 1.63m(하단선 기준) 정합을 위한 중심 Y 좌표 = 1.63 + 0.22/2 = 1.74m
    meterGroup.position.set(
        getWorldX(3650) - 0.06 - 0.002, // 동측 벽면 안쪽 밀착
        1.74,
        getWorldZ(10500)
    );
    scene.add(meterGroup);
    detailObjects.push(meterGroup);

    // 6. 스위치 및 콘센트 플레이트 정밀 이식
    // 6.1 세탁기 벽면 수직 정렬 플레이트 2개 (남측 벽 Z = 9060, 벽 두께 220mm의 반폭 110mm 오프셋 적용하여 Z=9170, X = 1380 부근)
    const createBalconySouthOutlet = (yCenter) => {
        const outlet = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.005), matGray);
        outlet.position.set(getWorldX(1380), yCenter, getWorldZ(9060 + 110) - 0.003); // 벽체 두께 220mm 반영 돌출 보정 (Z=9170 라인)
        scene.add(outlet);
        detailObjects.push(outlet);
    };
    // 하단 콘센트: 바닥고 1.42m (중심 Y = 1.48)
    createBalconySouthOutlet(1.48);
    // 상단 콘센트: 기기간격 170mm 이격 (중심 Y = 1.77)
    createBalconySouthOutlet(1.77);

    // 6.2 가스계량기 하단 동측벽 플레이트 2개 (동측 X = 3650, Z = 10500 부근)
    const createBalconyEastDevice = (yCenter, isSwitch = false) => {
        const dev = new THREE.Mesh(new THREE.BoxGeometry(0.005, isSwitch ? 0.12 : 0.07, isSwitch ? 0.12 : 0.12), isSwitch ? matBlack : matGray);
        dev.position.set(getWorldX(3650) - 0.003, yCenter, getWorldZ(10500));
        scene.add(dev);
        detailObjects.push(dev);
    };
    // 스위치 (Y = 1.15m)
    createBalconyEastDevice(1.15, true);
    // 콘센트 (Y = 0.50m)
    createBalconyEastDevice(0.50, false);
}

function updateWallsVisibility() {
    roomWalls.forEach(wall => {
        wall.visible = !is2DMode;
    });
}

// --- 2D 평면도 모드 시 외곽 외부 치수선 구현 ---
function buildDimensionGuides() {
    if (dimensionsGroup) scene.remove(dimensionsGroup);
    
    dimensionsGroup = new THREE.Group();
    dimensionsGroup.name = "dimensionsGroup";
    dimensionsGroup.visible = false; 

    const dimLineMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, linewidth: 2 });
    const extLineMat = new THREE.LineBasicMaterial({ 
        color: 0x475569, 
        transparent: true,
        opacity: 0.55
    });

    DIMENSION_SEGMENTS.forEach(seg => {
        const x1 = getWorldX(seg.x1);
        const z1 = getWorldZ(seg.z1);
        const x2 = getWorldX(seg.x2);
        const z2 = getWorldZ(seg.z2);
        
        const dimPts = [new THREE.Vector3(x1, 0.02, z1), new THREE.Vector3(x2, 0.02, z2)];
        const dimGeo = new THREE.BufferGeometry().setFromPoints(dimPts);
        const dimLine = new THREE.Line(dimGeo, dimLineMat);
        // 치수 가이드라인 중심점 지정
        dimLine.userData = dimLine.userData || {};
        dimLine.userData.center = new THREE.Vector3((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
        dimensionsGroup.add(dimLine);

        const dx = x2 - x1;
        const dz = z2 - z1;
        const len = Math.sqrt(dx*dx + dz*dz);
        const nx = -dz / len * 0.15; 
        const nz = dx / len * 0.15;

        const drawTick = (px, pz) => {
            const tkPts = [
                new THREE.Vector3(px - nx, 0.02, pz - nz),
                new THREE.Vector3(px + nx, 0.02, pz + nz)
            ];
            const tkGeo = new THREE.BufferGeometry().setFromPoints(tkPts);
            const tkLine = new THREE.Line(tkGeo, dimLineMat);
            // 눈금선 중심점 지정
            tkLine.userData = tkLine.userData || {};
            tkLine.userData.center = new THREE.Vector3(px, 0.02, pz);
            dimensionsGroup.add(tkLine);
        };
        drawTick(x1, z1);
        drawTick(x2, z2);

        const rx1 = getWorldX(seg.refX1);
        const rz1 = getWorldZ(seg.refZ1);
        const rx2 = getWorldX(seg.refX2);
        const rz2 = getWorldZ(seg.refZ2);

        const drawExtLine = (startPt, endPt) => {
            const extPts = [startPt, endPt];
            const extGeo = new THREE.BufferGeometry().setFromPoints(extPts);
            const extLine = new THREE.Line(extGeo, extLineMat);
            // 연장선 중심점 지정
            extLine.userData = extLine.userData || {};
            extLine.userData.center = new THREE.Vector3((startPt.x + endPt.x) / 2, 0.02, (startPt.z + endPt.z) / 2);
            dimensionsGroup.add(extLine);
        };
        drawExtLine(new THREE.Vector3(rx1, 0.02, rz1), new THREE.Vector3(x1, 0.02, z1));
        drawExtLine(new THREE.Vector3(rx2, 0.02, rz2), new THREE.Vector3(x2, 0.02, z2));
    });

    scene.add(dimensionsGroup);
}

// --- 방 이름 및 치수 2D HTML 오버레이 라벨 생성 ---
function buildRoomLabelsDOM() {
    const container = document.getElementById('room-labels-container');
    container.innerHTML = '';
    // [공간 마스킹 제거] 시야를 방해하고 클릭 조작을 차단하던 방 이름 2D 라벨 생성을 완전히 중단합니다.
    return;
    
    ROOMS_DATA.forEach(room => {
        // 사용하지 않는 복도, 주방복도, 드레스룸 2D 라벨 제외 마스킹
        if (['passage', 'kitchen_passage', 'dressroom'].includes(room.id)) {
            return;
        }
        const px = getWorldX(room.x + room.w / 2);
        const pz = getWorldZ(room.z + room.d / 2);
        
        const div = document.createElement('div');
        div.className = 'room-label';
        div.innerText = room.name;
        
        div.dataset.x = px;
        div.dataset.y = 0.05; 
        div.dataset.z = pz;
        div.dataset.roomId = room.id;
        
        // 클릭 시 해당 방 내부 1인칭 뷰로 카메라 부드럽게 진입
        div.addEventListener('click', () => {
            focusRoom1stPerson(room);
        });
        
        container.appendChild(div);
    });

    if (is2DMode) {
        buildDimensionLabelsDOM();
    }
}

// 특정 방을 클릭했을 때 해당 방 중앙 사람 눈높이 시점으로 카메라를 부드럽게 비행(Fly-in) 진입시키는 함수
function focusRoom1stPerson(room) {
    if (is2DMode || !controls) return; // 2D 평면도 모드일 때는 비활성화
    
    const cx = getWorldX(room.x + room.w / 2);
    const cz = getWorldZ(room.z + room.d / 2);
    
    // 방 내부 사람 눈높이 (1.3m) 및 방 중앙 시야 설정
    // 카메라는 방 중앙에서 살짝 남쪽(+Z)으로 0.3m 비켜 서고, 타겟은 북쪽(-Z)을 바라봄으로써 방 내부 시야를 최적화
    const targetCamPos = new THREE.Vector3(cx, 1.3, cz + 0.3); 
    const targetLookAt = new THREE.Vector3(cx, 1.2, cz - 0.5); 
    
    // 0.4초간 가속/감속 보간 비행 애니메이션 실행
    let duration = 400; // ms
    let startTime = performance.now();
    
    const startCamPos = camera.position.clone();
    const startTarget = controls.target.clone();
    
    function animateFocus(now) {
        let elapsed = now - startTime;
        let progress = Math.min(elapsed / duration, 1);
        
        // EaseInOutQuad 가속도 커브 적용
        let ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
        
        camera.position.lerpVectors(startCamPos, targetCamPos, ease);
        controls.target.lerpVectors(startTarget, targetLookAt, ease);
        
        if (controls) {
            controls.update();
        }
        
        if (progress < 1) {
            requestAnimationFrame(animateFocus);
        }
    }
    requestAnimationFrame(animateFocus);
}

function buildDimensionLabelsDOM() {
    const container = document.getElementById('room-labels-container');
    
    DIMENSION_SEGMENTS.forEach((seg, idx) => {
        const px = getWorldX(seg.textX);
        const pz = getWorldZ(seg.textZ);
        
        const div = document.createElement('div');
        div.className = 'dimension-label';
        div.innerText = seg.label;
        
        div.dataset.x = px;
        div.dataset.y = 0.06; 
        div.dataset.z = pz;
        div.dataset.dimId = `dim_${idx}`;
        
        container.appendChild(div);
    });
}

function destroyDimensionLabelsDOM() {
    const labels = document.querySelectorAll('.dimension-label');
    labels.forEach(l => l.remove());
}

function updateRoomLabels() {
    const labels = document.querySelectorAll('.room-label, .dimension-label, .bedroom2-dim-label');
    
    // 3D 가이드라인 가시성 연동 필터링 (임계값 4.5m)
    const maxDist = 4.5;
    
    if (dimensionsGroup) {
        dimensionsGroup.children.forEach(obj => {
            if (obj.userData && obj.userData.center) {
                const dist = camera.position.distanceTo(obj.userData.center);
                obj.visible = (dist <= maxDist);
            }
        });
    }
    
    if (bedroom2DimGroup) {
        bedroom2DimGroup.children.forEach(obj => {
            if (obj.userData && obj.userData.center) {
                const dist = camera.position.distanceTo(obj.userData.center);
                obj.visible = (dist <= maxDist);
            }
        });
    }

    if (labels.length === 0) return;
    
    const container = document.getElementById('canvas-container');
    const widthHalf = container.clientWidth / 2;
    const heightHalf = container.clientHeight / 2;
    
    const tempV = new THREE.Vector3();
    
    labels.forEach(label => {
        const px = parseFloat(label.dataset.x);
        const py = parseFloat(label.dataset.y);
        const pz = parseFloat(label.dataset.z);
        
        tempV.set(px, py, pz);
        
        // 카메라와의 실제 3D 거리 계산
        const dist = camera.position.distanceTo(tempV);
        
        tempV.project(camera);
        
        // 뒤에 있거나, 치수 라벨인데 거리가 4.5m를 초과하는 경우 숨김
        const isDimLabel = label.classList.contains('dimension-label') || label.classList.contains('bedroom2-dim-label');
        if (tempV.z > 1 || (isDimLabel && dist > maxDist)) {
            label.style.opacity = 0;
            label.style.pointerEvents = 'none';
            return;
        }
        
        const screenX = (tempV.x * widthHalf) + widthHalf;
        const screenY = -(tempV.y * heightHalf) + heightHalf;
        
        label.style.opacity = 1;
        label.style.pointerEvents = 'auto';
        label.style.left = `${screenX}px`;
        label.style.top = `${screenY}px`;
    });
}

// --- 카탈로그 인터페이스 연동 ---
function initCatalog() {
    const listContainer = document.getElementById('catalog-list');
    listContainer.innerHTML = '';
    
    const activeTab = document.querySelector('.tab-btn.active');
    const category = activeTab ? activeTab.dataset.category : 'living';
    
    const filtered = CATALOG.filter(item => item.category === category);
    
    filtered.forEach(item => {
        const div = document.createElement('div');
        div.className = 'catalog-item';
        div.dataset.id = item.id;
        
        div.innerHTML = `
            <i class="fa-solid ${item.icon}"></i>
            <span>${item.name}</span>
            <small>${item.width} x ${item.depth} (mm)</small>
        `;
        
        // [사용자 신규 생성 차단] 카탈로그 아이템 클릭을 통한 신규 가구 스폰(추가) 기능을 전면 비활성화합니다.
        div.addEventListener('click', () => {
            // addFurnitureToRoom(item.id); 
        });
        
        listContainer.appendChild(div);
    });
}

// --- 가구 오브젝트 배치 추가 ---
function addFurnitureToRoom(catalogId, positionData = null) {
    const catalogItem = CATALOG.find(item => item.id === catalogId);
    if (!catalogItem) return;
    
    const objGroup = createFurnitureMesh(catalogItem);
    
    if (positionData) {
        objGroup.position.set(positionData.x, positionData.y, positionData.z);
        objGroup.rotation.y = positionData.rotation;
        
        if (positionData.width && positionData.depth && positionData.height) {
            updateObjectDimensions(objGroup, positionData.width, positionData.depth, positionData.height);
        }
        if (positionData.color) {
            updateObjectColor(objGroup, positionData.color);
        }
    } else {
        objGroup.position.set(0, 0, 0);
        selectObject(objGroup);
    }
    
    scene.add(objGroup);
    furnitureList.push(objGroup);
}

function updateObjectDimensions(objGroup, width, depth, height) {
    objGroup.userData.width = width;
    objGroup.userData.depth = depth;
    objGroup.userData.height = height;
    
    const catalogItem = CATALOG.find(item => item.id === objGroup.userData.catalogId);
    if (!catalogItem) return;
    
    // [커스텀 재생성 로직] 가구 타입이 custom_ 으로 시작하면 찌그러짐을 막기 위해 3D 메쉬 재생성 조립을 실행
    if (catalogItem.type && catalogItem.type.startsWith('custom_')) {
        const toRemove = [];
        objGroup.children.forEach(child => {
            if (child.name !== "selectionOutline") {
                toRemove.push(child);
            }
        });
        toRemove.forEach(child => objGroup.remove(child));
        
        const tempItem = Object.assign({}, catalogItem, { 
            width: width, 
            depth: depth, 
            height: height, 
            color: objGroup.userData.color || catalogItem.color,
            frameColor: objGroup.userData.frameColor || catalogItem.frameColor || '#f8fafc'
        });
        
        const newGroup = createCustomFurnitureMesh(tempItem);
        if (newGroup) {
            while (newGroup.children.length > 0) {
                const mesh = newGroup.children[0];
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                objGroup.add(mesh);
            }
        }
        // 재생성 이후 변경된 크기에 맞춰 아웃라인 가이드선 갱신
        updateOutline();
        return;
    }
    
    const scaleX = width / catalogItem.width;
    const scaleY = height / catalogItem.height;
    const scaleZ = depth / catalogItem.depth;
    
    objGroup.scale.set(scaleX, scaleY, scaleZ);
}

function updateObjectColor(objGroup, colorHex) {
    objGroup.userData.color = colorHex;
    const color = new THREE.Color(colorHex);
    
    objGroup.traverse(child => {
        if (child.isMesh && child.material) {
            const isSpecific = 
                child.material.color.getHexString() === '8b5a2b' || 
                child.material.color.getHexString() === '94a3b8' || 
                child.material.color.getHexString() === 'f8fafc' || 
                child.material.color.getHexString() === '718096' || // 모션데스크 다리 메탈그레이 고정
                child.material.color.getHexString() === '63b3ed';
                
            if (!isSpecific) {
                child.material.color.copy(color);
            }
        }
    });
}

// [모션데스크 전용 색상 갱신] 상판과 프레임 색상을 각각 받아와 3D 메쉬 재생성 조립
function updateDeskColors(objGroup, topColorHex, frameColorHex) {
    objGroup.userData.color = topColorHex;
    objGroup.userData.frameColor = frameColorHex;
    
    const catalogItem = CATALOG.find(item => item.id === objGroup.userData.catalogId);
    if (!catalogItem) return;
    
    const toRemove = [];
    objGroup.children.forEach(child => {
        if (child.name !== "selectionOutline") {
            toRemove.push(child);
        }
    });
    toRemove.forEach(child => objGroup.remove(child));
    
    const tempItem = Object.assign({}, catalogItem, { 
        width: objGroup.userData.width, 
        depth: objGroup.userData.depth, 
        height: objGroup.userData.height, 
        color: topColorHex,
        frameColor: frameColorHex
    });
    
    const newGroup = createCustomFurnitureMesh(tempItem);
    if (newGroup) {
        while (newGroup.children.length > 0) {
            const mesh = newGroup.children[0];
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            objGroup.add(mesh);
        }
    }
}

// --- 객체 선택 컨트롤 ---
function selectObject(obj) {
    if (selectedObject) {
        removeSelectionHelper(selectedObject);
    }
    
    selectedObject = obj;
    
    if (selectedObject) {
        addSelectionHelper(selectedObject);
        
        document.querySelector('.no-selection-msg').style.display = 'none';
        document.querySelector('.selection-controls').style.display = 'block';
        
        document.getElementById('selected-name').innerText = selectedObject.name;
        
        // [가로 폭 제어] 핏쳐 모션데스크 E2 제품인 경우 드롭다운 활성화, 그 외는 일반 input 활성화
        const isFitureDesk = selectedObject.userData.catalogId === 'fiture_desk_e2';
        const isHanger = ['layout_hanger_800', 'layout_hanger_600'].includes(selectedObject.userData.catalogId);
        
        const inputWidth = document.getElementById('selected-width');
        const selectWidth = document.getElementById('selected-width-select');
        const inputDepth = document.getElementById('selected-depth');
        const inputHeight = document.getElementById('selected-height');
        
        // 완제품 행거 2종의 경우 사용자의 임의 치수 변동을 차단(Lock)합니다.
        inputWidth.disabled = isHanger;
        selectWidth.disabled = isHanger;
        inputDepth.disabled = isHanger;
        inputHeight.disabled = isHanger;
        
        if (isFitureDesk) {
            inputWidth.style.display = 'none';
            selectWidth.style.display = 'block';
            selectWidth.value = selectedObject.userData.width;
        } else {
            inputWidth.style.display = 'block';
            selectWidth.style.display = 'none';
            inputWidth.value = selectedObject.userData.width;
        }
        
        inputDepth.value = selectedObject.userData.depth;
        inputHeight.value = selectedObject.userData.height;
        document.getElementById('selected-pos-y').value = Math.round(selectedObject.position.y * UNIT_TO_MM);
        
        const deg = Math.round(selectedObject.rotation.y * (180 / Math.PI));
        document.getElementById('selected-rotation').value = deg;
        document.getElementById('rotation-val').innerText = `${deg}°`;
        
        const groupFurnitureColor = document.getElementById('group-furniture-color');
        const groupDeskColors = document.getElementById('group-desk-colors');
        
        if (isFitureDesk) {
            groupFurnitureColor.style.display = 'none';
            groupDeskColors.style.display = 'block';
            
            document.getElementById('selected-desk-top-color').value = selectedObject.userData.color;
            document.getElementById('selected-desk-frame-color').value = selectedObject.userData.frameColor || '#f8fafc';
        } else {
            groupFurnitureColor.style.display = 'block';
            groupDeskColors.style.display = 'none';
            
            document.getElementById('selected-color').value = selectedObject.userData.color;
        }
    } else {
        document.querySelector('.no-selection-msg').style.display = 'block';
        document.querySelector('.selection-controls').style.display = 'none';
    }
}

function addSelectionHelper(obj) {
    const boxHelper = new THREE.BoxHelper(obj, 0x6366f1);
    boxHelper.name = "selectionOutline";
    // [이중 상속 오프셋 버그 해결] 가이드선을 가구의 자식이 아닌 씬(scene)에 직접 추가하여 위치 2배 어긋남 해결
    scene.add(boxHelper);
}

function removeSelectionHelper(obj) {
    const boxHelper = scene.getObjectByName("selectionOutline");
    if (boxHelper) {
        scene.remove(boxHelper);
    }
}

// --- UI 이벤트 리스너 연동 ---
function initUIEventListeners() {
    const container = document.getElementById('canvas-container');
    
    // 키보드 조작 이벤트 연동 (1인칭 이동용)
    window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
        
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) {
            keys[e.key] = true;
            e.preventDefault(); // 스크롤 등 기본 동작 차단
        }
    });

    window.addEventListener('keyup', (e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) {
            keys[e.key] = false;
        }
    });
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            initCatalog();
        });
    });
    
    // [OrbitControls 조작 선점 차단] pointerdown 이벤트를 캡처(true) 단계에서 감청하여 카메라 궤도 제어 이전에 가구 선택 픽킹이 무조건 먼저 실행되게 보장합니다.
    renderer.domElement.addEventListener('pointerdown', onMouseDown, true);
    renderer.domElement.addEventListener('pointermove', onMouseMove, false);
    window.addEventListener('pointerup', onMouseUp, false);
    
    // 조명 조절 슬라이더 이벤트 리스너 등록
    const bindLightSlider = (sliderId, textId, lightKey) => {
        const slider = document.getElementById(sliderId);
        const textSpan = document.getElementById(textId);
        if (!slider || !textSpan) return;
        
        slider.addEventListener('input', (e) => {
            const pct = parseInt(e.target.value) || 0;
            textSpan.textContent = pct + '%';
            const multiplier = pct / 100;
            
            const lights = window.appLights[lightKey];
            if (lights) {
                lights.forEach(item => {
                    if (item.obj) {
                        item.obj.intensity = item.defaultVal * multiplier;
                    }
                });
            }
        });
    };
    
    bindLightSlider('light-global', 'light-global-val', 'global');
    bindLightSlider('light-living', 'light-living-val', 'living');
    bindLightSlider('light-bedroom1', 'light-bedroom1-val', 'bedroom1');
    bindLightSlider('light-dressroom', 'light-dressroom-val', 'dressroom');
    bindLightSlider('light-kitchen', 'light-kitchen-val', 'kitchen');
    bindLightSlider('light-bedroom2', 'light-bedroom2-val', 'bedroom2');
    
    // 뷰포트 제어
    document.getElementById('btn-view-3d').addEventListener('click', (e) => {
        is2DMode = false;
        document.getElementById('btn-view-2d').classList.remove('active');
        e.currentTarget.classList.add('active');
        controls.enableRotate = true;
        
        if (dimensionsGroup) dimensionsGroup.visible = false; 
        destroyDimensionLabelsDOM(); 
        buildRoomLabelsDOM(); 
        
        // 3D 뷰에서는 격자 헬퍼 숨김
        const gh = scene.getObjectByName("gridHelper");
        if (gh) gh.visible = false;

        resetCameraPosition();
        updateWallsVisibility();
    });
    
    document.getElementById('btn-view-2d').addEventListener('click', (e) => {
        is2DMode = true;
        document.getElementById('btn-view-3d').classList.remove('active');
        e.currentTarget.classList.add('active');
        controls.enableRotate = false;
        
        if (dimensionsGroup) dimensionsGroup.visible = true; 
        buildRoomLabelsDOM(); 
        
        // 2D 뷰에서는 격자 헬퍼 활성화
        const gh = scene.getObjectByName("gridHelper");
        if (gh) gh.visible = true;

        resetCameraPosition();
        updateWallsVisibility();
    });
    
    document.getElementById('btn-reset-camera').addEventListener('click', resetCameraPosition);
    
    document.getElementById('btn-clear-scene').addEventListener('click', () => {
        if (confirm("배치된 모든 가구를 삭제하시겠습니까?")) {
            clearAllFurniture();
        }
    });
    
    document.getElementById('selected-width').addEventListener('input', (e) => {
        if (!selectedObject) return;
        const val = parseFloat(e.target.value) || 100;
        updateObjectDimensions(selectedObject, val, selectedObject.userData.depth, selectedObject.userData.height);
        updateOutline();
    });

    document.getElementById('selected-width-select').addEventListener('change', (e) => {
        if (!selectedObject) return;
        const val = parseFloat(e.target.value) || 1200;
        updateObjectDimensions(selectedObject, val, selectedObject.userData.depth, selectedObject.userData.height);
        updateOutline();
    });
    
    document.getElementById('selected-depth').addEventListener('input', (e) => {
        if (!selectedObject) return;
        const val = parseFloat(e.target.value) || 100;
        updateObjectDimensions(selectedObject, selectedObject.userData.width, val, selectedObject.userData.height);
        updateOutline();
    });
    
    document.getElementById('selected-height').addEventListener('input', (e) => {
        if (!selectedObject) return;
        const val = parseFloat(e.target.value) || 100;
        updateObjectDimensions(selectedObject, selectedObject.userData.width, selectedObject.userData.depth, val);
        updateOutline();
    });
    
    document.getElementById('selected-rotation').addEventListener('input', (e) => {
        if (!selectedObject) return;
        const deg = parseFloat(e.target.value);
        document.getElementById('rotation-val').innerText = `${deg}°`;
        selectedObject.rotation.y = deg * (Math.PI / 180);
    });

    document.getElementById('selected-pos-y').addEventListener('input', (e) => {
        if (!selectedObject) return;
        const val = parseFloat(e.target.value) || 0;
        selectedObject.position.y = val * MM_TO_UNIT;
        updateOutline();
    });
    
    document.getElementById('selected-color').addEventListener('input', (e) => {
        if (!selectedObject) return;
        updateObjectColor(selectedObject, e.target.value);
    });

    document.getElementById('selected-desk-top-color').addEventListener('change', (e) => {
        if (!selectedObject) return;
        const frameColor = document.getElementById('selected-desk-frame-color').value;
        updateDeskColors(selectedObject, e.target.value, frameColor);
    });

    document.getElementById('selected-desk-frame-color').addEventListener('change', (e) => {
        if (!selectedObject) return;
        const topColor = document.getElementById('selected-desk-top-color').value;
        updateDeskColors(selectedObject, topColor, e.target.value);
    });
    
    document.getElementById('btn-delete-selected').addEventListener('click', () => {
        if (!selectedObject) return;
        deleteFurniture(selectedObject);
    });

    document.getElementById('btn-export-json').addEventListener('click', exportLayoutJSON);
    
    const importTrigger = document.getElementById('btn-import-trigger');
    const importInput = document.getElementById('input-import-json');
    importTrigger.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', importLayoutJSON);
}

function updateOutline() {
    if (!selectedObject) return;
    const boxHelper = scene.getObjectByName("selectionOutline");
    if (boxHelper) {
        boxHelper.update();
    }
}

// --- 마우스 인터랙션 좌표 변환 및 클릭 핸들러 ---
function getCanvasMouseCoords(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return { x, y };
}

function onMouseDown(event) {
    // 캔버스 컨테이너 영역 내에서 클릭이 발생했는지 확인하여 투명 라벨 오버레이 클릭 씹힘 차단
    const container = document.getElementById('canvas-container');
    if (!container || !container.contains(event.target)) return;
    event.preventDefault();
    
    const coords = getCanvasMouseCoords(event);
    mouse.x = coords.x;
    mouse.y = coords.y;
    
    raycaster.setFromCamera(mouse, camera);
    
    // 방문 클릭 감지를 포함하여 scene 전체의 오브젝트 레이캐스팅
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    if (intersects.length > 0) {
        let hitObj = null;
        for (let i = 0; i < intersects.length; i++) {
            const obj = intersects[i].object;
            
            // 이 충돌체가 오클루전 투명화된 벽체/문/cove인지 검사
            let isOccludedWall = false;
            let p = obj;
            while (p && p !== scene) {
                if (roomWalls.includes(p)) {
                    // 이 벽체의 메쉬들이 투명화되었는지 확인
                    let hasTransparentMesh = false;
                    p.traverse(child => {
                        if (child.isMesh && child.material) {
                            const mats = Array.isArray(child.material) ? child.material : [child.material];
                            mats.forEach(mat => {
                                if (mat && mat.transparent && mat.opacity < 0.9) {
                                    hasTransparentMesh = true;
                                }
                            });
                        }
                    });
                    if (hasTransparentMesh) {
                        isOccludedWall = true;
                    }
                    break;
                }
                p = p.parent;
            }
            
            // 만약 반투명 상태인 벽체/문이라면 관통(스킵) 처리
            if (isOccludedWall) {
                continue;
            }
            
            // 투명하지 않은 실제 물체를 찾았으므로 hitObj로 설정하고 루프 종료
            hitObj = obj;
            break;
        }
        
        if (!hitObj) {
            selectObject(null);
            return;
        }
        
        // 1. 방문 클릭 토글 인터랙션 감지
        let isDoorClick = false;
        let p = hitObj;
        while (p) {
            if (p.name === "bedroom2_door_panel") {
                isDoorClick = true;
                break;
            }
            p = p.parent;
        }
        
        if (isDoorClick && doorPivot) {
            isDoorOpen = !isDoorOpen;
            const targetRot = isDoorOpen ? -Math.PI * 0.47 : 0;
            
            // 방문 개폐 부드러운 애니메이션 보간 (150ms)
            let duration = 150; 
            let startTime = performance.now();
            let startRot = doorPivot.rotation.y;
            
            function animateDoor(now) {
                let elapsed = now - startTime;
                let progress = Math.min(elapsed / duration, 1);
                doorPivot.rotation.y = startRot + (targetRot - startRot) * progress;
                if (progress < 1) {
                    requestAnimationFrame(animateDoor);
                }
            }
            requestAnimationFrame(animateDoor);
            
            selectObject(null);
            return;
        }
        
        // 2. 가구 선택 및 드래그 로직
        let target = hitObj;
        while (target.parent && target.parent !== scene) {
            target = target.parent;
        }
        
        if (furnitureList.includes(target)) {
            selectObject(target);
            controls.enabled = false;
            isDragging = true;
            
            dragPlane.setFromNormalAndCoplanarPoint(
                new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(0, target.position.y, 0)
            );
            
            if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
                dragOffset.copy(target.position).sub(intersectionPoint);
            }
            
            // OrbitControls가 이 이벤트를 조작 모드로 받아 화면을 회전시키는 것을 원천 차단
            event.stopPropagation();
            event.stopImmediatePropagation();
        } else {
            selectObject(null);
        }
    } else {
        selectObject(null);
    }
}

function onMouseMove(event) {
    if (!isDragging || !selectedObject) return;
    
    // 드래그하는 도중 카메라 조작이나 다른 리스너가 이벤트를 낚아채지 못하게 방지
    event.stopPropagation();
    
    const coords = getCanvasMouseCoords(event);
    mouse.x = coords.x;
    mouse.y = coords.y;
    
    raycaster.setFromCamera(mouse, camera);
    
    if (raycaster.ray.intersectPlane(dragPlane, intersectionPoint)) {
        const targetPos = intersectionPoint.clone().add(dragOffset);
        
        const wLimit = (PLAN_WIDTH * MM_TO_UNIT) / 2;
        const dLimit = (PLAN_DEPTH * MM_TO_UNIT) / 2;
        
        const fW = (selectedObject.userData.width * MM_TO_UNIT) / 2;
        const fD = (selectedObject.userData.depth * MM_TO_UNIT) / 2;
        
        targetPos.x = THREE.MathUtils.clamp(targetPos.x, -wLimit + fW, wLimit - fW);
        targetPos.z = THREE.MathUtils.clamp(targetPos.z, -dLimit + fD, dLimit - fD);
        
        selectedObject.position.x = targetPos.x;
        selectedObject.position.z = targetPos.z;
        
        updateOutline();
    }
}

function onMouseUp() {
    isDragging = false;
    controls.enabled = true;
}

// --- 데이터 정리 및 개별 가구 생성 위임 함수 ---
function clearAllFurniture() {
    selectObject(null);
    furnitureList.forEach(obj => scene.remove(obj));
    furnitureList = [];
}

function deleteFurniture(obj) {
    selectObject(null);
    scene.remove(obj);
    const index = furnitureList.indexOf(obj);
    if (index > -1) {
        furnitureList.splice(index, 1);
    }
}

// --- 가구 디테일 3D 생성 공장 ---
function createFurnitureMesh(catalogItem) {
    // 신규 가구/가전 모듈(appliances_furniture.js)의 커스텀 메쉬 빌더가 존재할 경우 호출 위임
    if (typeof createCustomFurnitureMesh === 'function') {
        const customMesh = createCustomFurnitureMesh(catalogItem);
        if (customMesh) {
            // 위임받은 커스텀 메쉬에도 그림자(Shadow) 속성 부여
            customMesh.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            // 핵심 메타데이터(userData)를 주입하여 마우스 피킹 및 속성 패널/크기 수정 연동이 원활히 작동하도록 함
            customMesh.userData = {
                catalogId: catalogItem.id,
                type: catalogItem.type,
                width: catalogItem.width,
                depth: catalogItem.depth,
                height: catalogItem.height,
                color: catalogItem.color,
                frameColor: catalogItem.frameColor || '#f8fafc'
            };
            return customMesh;
        }
    }

    const group = new THREE.Group();
    group.name = catalogItem.name;
    
    const w = catalogItem.width * MM_TO_UNIT;
    const d = catalogItem.depth * MM_TO_UNIT;
    const h = catalogItem.height * MM_TO_UNIT;
    
    const color = new THREE.Color(catalogItem.color);
    
    const mainMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.6, metalness: 0.1 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.9, metalness: 0.02 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.2 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.2, metalness: 0.8 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7, metalness: 0.05 });

    switch(catalogItem.type) {
        case 'bed':
            const frameGeo = new THREE.BoxGeometry(w, h * 0.3, d);
            const frame = new THREE.Mesh(frameGeo, woodMat);
            frame.position.y = (h * 0.3) / 2;
            group.add(frame);
            
            const headGeo = new THREE.BoxGeometry(w, h, d * 0.08);
            const head = new THREE.Mesh(headGeo, woodMat);
            head.position.set(0, h / 2, -d/2 + (d * 0.04));
            group.add(head);
            
            const matGeo = new THREE.BoxGeometry(w * 0.94, h * 0.4, d * 0.88);
            const mattress = new THREE.Mesh(matGeo, whiteMat);
            mattress.position.set(0, (h * 0.3) + (h * 0.4)/2, d * 0.04);
            group.add(mattress);
            
            const pillowW = w * 0.35;
            const pillowD = d * 0.15;
            const pillowH = h * 0.1;
            const pillowGeo = new THREE.BoxGeometry(pillowW, pillowH, pillowD);
            
            const pillow1 = new THREE.Mesh(pillowGeo, mainMat);
            pillow1.position.set(-w * 0.2, (h * 0.7) + pillowH/2, -d * 0.3);
            pillow1.rotation.x = -0.1;
            group.add(pillow1);

            const pillow2 = new THREE.Mesh(pillowGeo, mainMat);
            pillow2.position.set(w * 0.2, (h * 0.7) + pillowH/2, -d * 0.3);
            pillow2.rotation.x = -0.1;
            group.add(pillow2);
            break;
            
        case 'sofa':
            const baseGeo = new THREE.BoxGeometry(w, h * 0.3, d);
            const base = new THREE.Mesh(baseGeo, mainMat);
            base.position.y = (h * 0.3) / 2;
            group.add(base);
            
            const backGeo = new THREE.BoxGeometry(w, h * 0.7, d * 0.2);
            const back = new THREE.Mesh(backGeo, mainMat);
            back.position.set(0, (h * 0.3) + (h * 0.7)/2, -d/2 + (d * 0.1));
            group.add(back);
            
            const armW = w * 0.08;
            const armGeo = new THREE.BoxGeometry(armW, h * 0.6, d * 0.95);
            const armL = new THREE.Mesh(armGeo, mainMat);
            armL.position.set(-w/2 + armW/2, (h * 0.6)/2, d * 0.025);
            group.add(armL);

            const armR = new THREE.Mesh(armGeo, mainMat);
            armR.position.set(w/2 - armW/2, (h * 0.6)/2, d * 0.025);
            group.add(armR);

            const cushionW = (w - (armW * 2)) / 3;
            const cushionGeo = new THREE.BoxGeometry(cushionW * 0.96, h * 0.15, d * 0.75);
            for(let i=0; i<3; i++) {
                const cushion = new THREE.Mesh(cushionGeo, mainMat);
                const ox = -cushionW + (i * cushionW);
                cushion.position.set(ox, (h * 0.3) + (h * 0.15)/2, d * 0.05);
                group.add(cushion);
            }
            break;
            
        case 'cabinet':
            const bodyGeo = new THREE.BoxGeometry(w, h, d);
            const cabinetBody = new THREE.Mesh(bodyGeo, mainMat);
            cabinetBody.position.y = h / 2;
            group.add(cabinetBody);
            
            const doorGeo = new THREE.BoxGeometry(w * 0.47, h * 0.94, d * 0.02);
            const doorL = new THREE.Mesh(doorGeo, mainMat.clone());
            doorL.material.color.multiplyScalar(0.92);
            doorL.position.set(-w * 0.24, h / 2, d / 2 + 0.005);
            group.add(doorL);

            const doorR = new THREE.Mesh(doorGeo, mainMat.clone());
            doorR.material.color.multiplyScalar(0.92);
            doorR.position.set(w * 0.24, h / 2, d / 2 + 0.005);
            group.add(doorR);
            
            const handleGeo = new THREE.CylinderGeometry(0.008, 0.008, h * 0.15);
            const handleL = new THREE.Mesh(handleGeo, steelMat);
            handleL.position.set(-0.02, h * 0.5, d / 2 + 0.02);
            group.add(handleL);

            const handleR = new THREE.Mesh(handleGeo, steelMat);
            handleR.position.set(0.02, h * 0.5, d / 2 + 0.02);
            group.add(handleR);
            break;
            
        case 'desk':
            const topGeo = new THREE.BoxGeometry(w, h * 0.05, d);
            const deskTop = new THREE.Mesh(topGeo, mainMat);
            deskTop.position.y = h - (h * 0.025);
            group.add(deskTop);
            
            const legH = h - (h * 0.05);
            const legGeo = new THREE.CylinderGeometry(0.025, 0.02, legH);
            const legOffsetW = w/2 - 0.05;
            const legOffsetD = d/2 - 0.05;
            const positions = [
                [-legOffsetW, legH/2, -legOffsetD],
                [legOffsetW, legH/2, -legOffsetD],
                [-legOffsetW, legH/2, legOffsetD],
                [legOffsetW, legH/2, legOffsetD]
            ];
            positions.forEach(pos => {
                const leg = new THREE.Mesh(legGeo, steelMat);
                leg.position.set(pos[0], pos[1], pos[2]);
                group.add(leg);
            });
            break;

        case 'table':
            const tableTopGeo = new THREE.BoxGeometry(w, h * 0.06, d);
            const tableTop = new THREE.Mesh(tableTopGeo, woodMat);
            tableTop.position.y = h - (h * 0.03);
            group.add(tableTop);

            const tLegH = h - (h * 0.06);
            const tLegGeo = new THREE.BoxGeometry(0.05, tLegH, 0.05);
            const tLegOffsetW = w/2 - 0.04;
            const tLegOffsetD = d/2 - 0.04;
            const tLegPositions = [
                [-tLegOffsetW, tLegH/2, -tLegOffsetD],
                [tLegOffsetW, tLegH/2, -tLegOffsetD],
                [-tLegOffsetW, tLegH/2, tLegOffsetD],
                [tLegOffsetW, tLegH/2, tLegOffsetD]
            ];
            tLegPositions.forEach(pos => {
                const leg = new THREE.Mesh(tLegGeo, woodMat);
                leg.position.set(pos[0], pos[1], pos[2]);
                group.add(leg);
            });
            break;
            
        case 'chair':
            const seatH = h * 0.5;
            const seatGeo = new THREE.BoxGeometry(w, h * 0.08, d);
            const seat = new THREE.Mesh(seatGeo, darkMat);
            seat.position.y = seatH;
            group.add(seat);
            
            const chairBackGeo = new THREE.BoxGeometry(w, h * 0.45, d * 0.08);
            const chairBack = new THREE.Mesh(chairBackGeo, darkMat);
            chairBack.position.set(0, seatH + (h * 0.45)/2, -d/2 + 0.04);
            group.add(chairBack);
            
            const supportGeo = new THREE.CylinderGeometry(0.02, 0.02, seatH);
            const support = new THREE.Mesh(supportGeo, steelMat);
            support.position.set(0, seatH/2, 0);
            group.add(support);
            
            const legW = w * 0.9;
            const legXGeo = new THREE.BoxGeometry(legW, 0.03, 0.03);
            const leg1 = new THREE.Mesh(legXGeo, steelMat);
            leg1.position.set(0, 0.02, 0);
            group.add(leg1);

            const leg2 = new THREE.Mesh(legXGeo, steelMat);
            leg2.position.set(0, 0.02, 0);
            leg2.rotation.y = Math.PI / 2;
            group.add(leg2);
            break;
            
        case 'refrigerator':
            const refGeo = new THREE.BoxGeometry(w, h, d);
            const refBody = new THREE.Mesh(refGeo, steelMat);
            refBody.position.y = h / 2;
            group.add(refBody);
            
            const refDoorGeo = new THREE.BoxGeometry(w * 0.48, h, d * 0.02);
            const refDoorL = new THREE.Mesh(refDoorGeo, steelMat.clone());
            refDoorL.material.roughness = 0.15;
            refDoorL.material.color.set('#b2c1d4');
            refDoorL.position.set(-w * 0.24, h/2, d/2 + 0.005);
            group.add(refDoorL);

            const refDoorR = new THREE.Mesh(refDoorGeo, steelMat.clone());
            refDoorR.material.roughness = 0.15;
            refDoorR.material.color.set('#b2c1d4');
            refDoorR.position.set(w * 0.24, h/2, d/2 + 0.005);
            group.add(refDoorR);
            
            const refLineGeo = new THREE.BoxGeometry(0.004, h * 0.98, 0.005);
            const refLine = new THREE.Mesh(refLineGeo, darkMat);
            refLine.position.set(0, h/2, d/2 + 0.011);
            group.add(refLine);
            break;

        case 'washer':
            const washGeo = new THREE.BoxGeometry(w, h, d);
            const washBody = new THREE.Mesh(washGeo, mainMat);
            washBody.position.y = h / 2;
            group.add(washBody);

            const glassRingGeo = new THREE.CylinderGeometry(w * 0.35, w * 0.35, d * 0.03, 32);
            const glassRing = new THREE.Mesh(glassRingGeo, steelMat);
            glassRing.rotation.x = Math.PI / 2;
            glassRing.position.set(0, h * 0.45, d / 2 + 0.005);
            group.add(glassRing);

            const glassGeo = new THREE.CylinderGeometry(w * 0.28, w * 0.28, d * 0.04, 32);
            const glassMat = new THREE.MeshStandardMaterial({
                color: 0x63b3ed, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.6
            });
            const glass = new THREE.Mesh(glassGeo, glassMat);
            glass.rotation.x = Math.PI / 2;
            glass.position.set(0, h * 0.45, d / 2 + 0.01);
            group.add(glass);
            break;

        case 'tv':
            const standH = h * 0.35;
            const standGeo = new THREE.BoxGeometry(w, standH, d);
            const tvStand = new THREE.Mesh(standGeo, woodMat);
            tvStand.position.y = standH / 2;
            group.add(tvStand);

            const tvW = w * 0.85;
            const tvH = h * 0.6;
            const tvD = 0.03;
            const tvPanelGeo = new THREE.BoxGeometry(tvW, tvH, tvD);
            const tvPanel = new THREE.Mesh(tvPanelGeo, darkMat);
            tvPanel.position.set(0, standH + tvH/2 + 0.05, 0);
            group.add(tvPanel);

            const tvLegGeo = new THREE.BoxGeometry(tvW * 0.4, 0.015, d * 0.4);
            const tvLeg = new THREE.Mesh(tvLegGeo, steelMat);
            tvLeg.position.set(0, standH + 0.008, 0);
            group.add(tvLeg);

            const tvPoleGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.05);
            const tvPole = new THREE.Mesh(tvPoleGeo, steelMat);
            tvPole.position.set(0, standH + 0.025, 0);
            group.add(tvPole);
            break;
            
        default:
            const defaultGeo = new THREE.BoxGeometry(w, h, d);
            const defaultMesh = new THREE.Mesh(defaultGeo, mainMat);
            defaultMesh.position.y = h / 2;
            group.add(defaultMesh);
    }
    
    group.traverse(child => {
        if(child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    group.userData = {
        catalogId: catalogItem.id,
        type: catalogItem.type,
        width: catalogItem.width,
        depth: catalogItem.depth,
        height: catalogItem.height,
        color: catalogItem.color
    };
    
    return group;
}

// --- JSON 데이터 저장 / 불러오기 ---
function exportLayoutJSON() {
    const furnitureData = furnitureList.map(obj => {
        return {
            catalogId: obj.userData.catalogId,
            name: obj.name,
            width: obj.userData.width,
            depth: obj.userData.depth,
            height: obj.userData.height,
            color: obj.userData.color,
            x: obj.position.x,
            y: obj.position.y,
            z: obj.position.z,
            rotation: obj.rotation.y
        };
    });
    
    const activeFloor = document.querySelector('.preset-item.active[data-type="floor"]');
    const activeWall = document.querySelector('.preset-item.active[data-type="wall"]');
    
    const saveData = {
        wallThickness: wallThickness,
        floorStyle: activeFloor ? activeFloor.dataset.preset : 'wood',
        wallStyle: activeWall ? activeWall.dataset.preset : 'white',
        furniture: furnitureData
    };
    
    const jsonStr = JSON.stringify(saveData, null, 4);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `apartment-49A-layout-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importLayoutJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            
            if (data.wallThickness) {
                wallThickness = data.wallThickness;
                document.getElementById('wall-thickness').value = wallThickness;
            }
            
            if (data.floorStyle) {
                document.querySelectorAll('.preset-item[data-type="floor"]').forEach(item => {
                    if(item.dataset.preset === data.floorStyle) {
                        item.classList.add('active');
                    } else {
                        item.classList.remove('active');
                    }
                });
            }
            if (data.wallStyle) {
                document.querySelectorAll('.preset-item[data-type="wall"]').forEach(item => {
                    if(item.dataset.preset === data.wallStyle) {
                        item.classList.add('active');
                    } else {
                        item.classList.remove('active');
                    }
                });
                wallTextures['custom'] = null;
            }
            
            buildApartment();
            buildDimensionGuides();
            
            clearAllFurniture();
            if (data.furniture && Array.isArray(data.furniture)) {
                data.furniture.forEach(item => {
                    addFurnitureToRoom(item.catalogId, item);
                });
            }
            
            alert("배치 데이터를 정상적으로 복원하였습니다!");
            
        } catch (err) {
            console.error(err);
            alert("올바르지 않은 배치 JSON 파일입니다.");
        }
        
        event.target.value = '';
    };
    reader.readAsText(file);
}

// 키보드 입력을 통해 카메라와 회전 타겟을 수평 이동시키는 1인칭 조작 로직
function updateKeyboardMovement() {
    if (is2DMode || !controls) return;
    
    // 하나라도 키가 눌려 있는지 검사
    const hasInput = keys.w || keys.s || keys.a || keys.d || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight;
    if (!hasInput) return;
    
    const moveSpeed = 0.08; // 프레임별 수평 이동 속도
    
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0; // 바닥 수평 전진 벡터 생성
    forward.normalize();
    
    // 카메라 matrixWorld를 사용해 정확한 로컬 오른쪽 방향을 구하고 Y수평화
    const right = new THREE.Vector3();
    right.setFromMatrixColumn(camera.matrixWorld, 0); 
    right.y = 0; 
    right.normalize();
    
    const moveVec = new THREE.Vector3();
    
    if (keys.ArrowUp || keys.w) {
        moveVec.addScaledVector(forward, moveSpeed);
    }
    if (keys.ArrowDown || keys.s) {
        moveVec.addScaledVector(forward, -moveSpeed);
    }
    // 좌우 반전 교정: ArrowLeft/a는 -right 방향, ArrowRight/d는 +right 방향
    if (keys.ArrowLeft || keys.a) {
        moveVec.addScaledVector(right, -moveSpeed);
    }
    if (keys.ArrowRight || keys.d) {
        moveVec.addScaledVector(right, moveSpeed);
    }
    
    if (moveVec.lengthSq() > 0) {
        camera.position.add(moveVec);
        controls.target.add(moveVec);
    }
}

// --- 벽체 시야 가림 감지 및 반투명도 제어 (방식 A) ---
const _occlusionRaycaster = new THREE.Raycaster();
const _occlusionRayDir = new THREE.Vector3();

function setWallOpacity(obj, opacity) {
    obj.traverse(child => {
        if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(mat => {
                if (mat) {
                    mat.transparent = (opacity < 1.0);
                    mat.opacity = opacity;
                    mat.needsUpdate = true;
                }
            });
        }
    });
}

function updateCameraOcclusion() {
    if (!camera || !controls || !roomWalls || roomWalls.length === 0) return;
    
    // 2D 모드에서는 벽체가 보이지 않으므로 제어 불필요
    if (is2DMode) return;
    
    // 카메라 위치에서 카메라 타겟 방향으로 광선 발사
    _occlusionRayDir.subVectors(controls.target, camera.position);
    const dist = _occlusionRayDir.length();
    _occlusionRayDir.normalize();
    
    _occlusionRaycaster.set(camera.position, _occlusionRayDir);
    _occlusionRaycaster.far = dist; // 타겟 너머는 감지하지 않음
    
    const intersects = _occlusionRaycaster.intersectObjects(roomWalls, true);
    
    const occludedWalls = new Set();
    intersects.forEach(hit => {
        // 카메라와 벽체 충돌 지점 간 거리가 2.0m 이내일 때만 반투명화 대상에 포함
        if (hit.distance <= 2.0) {
            let obj = hit.object;
            while (obj && obj !== scene) {
                if (roomWalls.includes(obj)) {
                    occludedWalls.add(obj);
                    break;
                }
                obj = obj.parent;
            }
        }
    });
    
    roomWalls.forEach(wall => {
        if (occludedWalls.has(wall)) {
            // 시야를 가로막는 벽면은 투명하게 (15% 불투명도)
            setWallOpacity(wall, 0.15);
        } else {
            // 가리지 않는 벽면은 완전 불투명 복원 (100% 불투명도)
            setWallOpacity(wall, 1.0);
        }
    });
}

// --- 3D 렌더링 루프 ---
function animate() {
    requestAnimationFrame(animate);
    
    updateKeyboardMovement();
    
    if (controls) {
        controls.update();
    }
    
    // 시야 가림 벽체 감지 및 제어 추가
    updateCameraOcclusion();
    
    updateRoomLabels();
    
    if (scene && camera && renderer) {
        renderer.render(scene, camera);
    }
}

// --- 침실2 실측 치수선 표시/숨김 토글 ---
function toggleBedroom2Dimensions() {
    const btn = document.getElementById('btn-bedroom2-dimensions');
    if (!btn) return;
    
    isBedroom2DimVisible = !isBedroom2DimVisible;
    
    if (isBedroom2DimVisible) {
        btn.classList.add('active');
        buildBedroom2DimensionGuides();
    } else {
        btn.classList.remove('active');
        if (bedroom2DimGroup) {
            scene.remove(bedroom2DimGroup);
            bedroom2DimGroup = null;
        }
        // 모든 침실2 치수선 DOM 라벨 삭제
        const dimLabels = document.querySelectorAll('.bedroom2-dim-label');
        dimLabels.forEach(label => label.remove());
    }
}

// --- 침실2 치수선 3D 메쉬 및 2D 라벨 생성 ---
function buildBedroom2DimensionGuides() {
    if (bedroom2DimGroup) {
        scene.remove(bedroom2DimGroup);
    }
    
    bedroom2DimGroup = new THREE.Group();
    bedroom2DimGroup.name = "bedroom2DimGroup";
    
    const dimColor = 0x0ea5e9; // 시인성 높은 네온 블루/하늘색
    // 벽체 내부에 묻혀 보이지 않는 현상을 원천 방지하기 위해 depthTest: false 적용
    const lineMat = new THREE.LineBasicMaterial({ 
        color: dimColor, 
        linewidth: 2, 
        depthTest: false, 
        transparent: true, 
        opacity: 0.85 
    });
    const tickMat = new THREE.LineBasicMaterial({ 
        color: dimColor, 
        linewidth: 2, 
        depthTest: false,
        transparent: true, 
        opacity: 0.85
    });
    
    // 침실2, 거실, 안방의 실측 수치 데이터 매핑
    const guides = [
        // --- 1. 침실2 실측 치수 가이드 ---
        { x1: 7580, z1: 2995, y1: 0.05, x2: 10280, z2: 2995, y2: 0.05, label: "침실2 가로 2,700 mm", textX: 8930, textZ: 2995, textY: 0.05, direction: 'x' },
        { x1: 9980, z1: 2495, y1: 0.05, x2: 9980, z2: 5945, y2: 0.05, label: "침실2 세로 3,450 mm", textX: 9980, textZ: 4220, textY: 0.05, direction: 'z' },
        { x1: 10180, z1: 2695, y1: 0, x2: 10180, z2: 2695, y2: 2.3, label: "천장높이 2,300 mm", textX: 10180, textZ: 2695, textY: 1.15, direction: 'y' },
        { x1: 7580, z1: 2605, y1: 1.13, x2: 8280, z2: 2605, y2: 1.13, label: "좌가벽 700 mm", textX: 7930, textZ: 2605, textY: 1.13, direction: 'x' },
        { x1: 8280, z1: 2605, y1: 1.13, x2: 9980, z2: 2605, y2: 1.13, label: "창문폭 1,700 mm", textX: 9130, textZ: 2605, textY: 1.13, direction: 'x' },
        { x1: 9980, z1: 2605, y1: 1.13, x2: 10280, z2: 2605, y2: 1.13, label: "우가벽 300 mm", textX: 10130, textZ: 2605, textY: 1.13, direction: 'x' },
        { x1: 8280, z1: 2605, y1: 0, x2: 8280, z2: 2605, y2: 1.13, label: "창문밑 1,130 mm", textX: 8280, textZ: 2605, textY: 0.56, direction: 'y' },
        { x1: 8280, z1: 2605, y1: 1.13, x2: 8280, z2: 2605, y2: 2.23, label: "창세로 1,100 mm", textX: 8280, textZ: 2605, textY: 1.68, direction: 'y' },
        { x1: 7700, z1: 5945, y1: 0.05, x2: 8600, z2: 5945, y2: 0.05, label: "방문폭 900 mm", textX: 8150, textZ: 5945, textY: 0.05, direction: 'x' },
        { x1: 7670, z1: 5945, y1: 0.15, x2: 8630, z2: 5945, y2: 0.15, label: "문틀포함 960 mm", textX: 8150, textZ: 5945, textY: 0.15, direction: 'x' },
        { x1: 8630, z1: 5945, y1: 1.12, x2: 8870, z2: 5945, y2: 1.12, label: "스위치간격 240 mm", textX: 8750, textZ: 5945, textY: 1.12, direction: 'x' },
        { x1: 8870, z1: 5945, y1: 0, x2: 8870, z2: 5945, y2: 1.12, label: "스위치고 1,120 mm", textX: 8870, textZ: 5945, textY: 0.56, direction: 'y' },
        { x1: 7580, z1: 5295, y1: 0, x2: 7580, z2: 5295, y2: 0.9, label: "배전반고 900 mm", textX: 7580, textZ: 5295, textY: 0.45, direction: 'y', isPanelOffset: true },

        // --- 2. 거실 실측 치수 가이드 ---
        { x1: 3760, z1: 4295, y1: 0.05, x2: 7360, z2: 4295, y2: 0.05, label: "거실 가로 3,600 mm", textX: 5560, textZ: 4295, textY: 0.05, direction: 'x' },
        { x1: 5560, z1: 2495, y1: 0.05, x2: 5560, z2: 6095, y2: 0.05, label: "거실 세로 3,600 mm", textX: 5560, textZ: 4295, textY: 0.05, direction: 'z' },
        { x1: 3760, z1: 2595, y1: 0.29, x2: 4210, z2: 2595, y2: 0.29, label: "좌가벽 450 mm", textX: 3985, textZ: 2595, textY: 0.29, direction: 'x' },
        { x1: 4210, z1: 2595, y1: 0.29, x2: 6910, z2: 2595, y2: 0.29, label: "창문폭 2,700 mm", textX: 5560, textZ: 2595, textY: 0.29, direction: 'x' },
        { x1: 6910, z1: 2595, y1: 0.29, x2: 7360, z2: 2595, y2: 0.29, label: "우가벽 450 mm", textX: 7135, textZ: 2595, textY: 0.29, direction: 'x' },
        { x1: 4210, z1: 2595, y1: 0, x2: 4210, z2: 2595, y2: 0.29, label: "창턱높이 290 mm", textX: 4210, textZ: 2595, textY: 0.15, direction: 'y' },
        
        // 거실 좌측 아트월 기기류 실측 가이드 신규 추가 및 정밀 보정
        { x1: 3760, z1: 5805, y1: 0, x2: 3760, z2: 5805, y2: 1.1, label: "스위치고 1,100 mm", textX: 3760, textZ: 5805, textY: 0.55, direction: 'y', isPanelOffset: true },
        { x1: 3760, z1: 5805, y1: 1.1, x2: 3760, z2: 5805, y2: 1.22, label: "스위치높이 120 mm", textX: 3760, textZ: 5805, textY: 1.16, direction: 'y', isPanelOffset: true },
        { x1: 3760, z1: 5805, y1: 1.22, x2: 3760, z2: 5805, y2: 1.32, label: "기기간격 100 mm", textX: 3760, textZ: 5805, textY: 1.27, direction: 'y', isPanelOffset: true },
        { x1: 3760, z1: 6095, y1: 1.1, x2: 3760, z2: 5745, y2: 1.1, label: "스위치이격 350 mm", textX: 3760, textZ: 5920, textY: 1.1, direction: 'z', isPanelOffset: true },
        { x1: 3760, z1: 6095, y1: 1.32, x2: 3760, z2: 5685, y2: 1.32, label: "인터폰이격 410 mm", textX: 3760, textZ: 5890, textY: 1.32, direction: 'z', isPanelOffset: true },
        
        { x1: 3760, z1: 4405, y1: 0, x2: 3760, z2: 4405, y2: 0.43, label: "콘센트하단 430 mm", textX: 3760, textZ: 4405, textY: 0.215, direction: 'y', isPanelOffset: true },
        { x1: 3760, z1: 4405, y1: 0.43, x2: 3760, z2: 4405, y2: 0.55, label: "하단콘센트고 120 mm", textX: 3760, textZ: 4405, textY: 0.49, direction: 'y', isPanelOffset: true },
        { x1: 3760, z1: 4405, y1: 0.55, x2: 3760, z2: 4405, y2: 0.83, label: "콘센트간격 280 mm", textX: 3760, textZ: 4405, textY: 0.69, direction: 'y', isPanelOffset: true },
        { x1: 3760, z1: 4405, y1: 0.83, x2: 3760, z2: 4405, y2: 0.95, label: "중간콘센트고 120 mm", textX: 3760, textZ: 4405, textY: 0.89, direction: 'y', isPanelOffset: true },
        { x1: 3760, z1: 2495, y1: 0.43, x2: 3760, z2: 4345, y2: 0.43, label: "콘센트이격 1,850 mm", textX: 3760, textZ: 3420, textY: 0.43, direction: 'z', isPanelOffset: true },

        // --- 3. 안방(침실1) 실측 치수 가이드 ---
        { x1: 240, z1: 4452.5, y1: 0.05, x2: 3540, z2: 4452.5, y2: 0.05, label: "안방 가로 3,300 mm", textX: 1890, textZ: 4452.5, textY: 0.05, direction: 'x' },
        { x1: 1890, z1: 2960, y1: 0.05, x2: 1890, z2: 5945, y2: 0.05, label: "안방 세로 2,985 mm", textX: 1890, textZ: 4452.5, textY: 0.05, direction: 'z' },
        { x1: 240, z1: 5955, y1: 0.05, x2: 840, z2: 5955, y2: 0.05, label: "좌가벽 600 mm", textX: 540, textZ: 5955, textY: 0.05, direction: 'x' },
        { x1: 840, z1: 5955, y1: 0.05, x2: 1840, z2: 5955, y2: 0.05, label: "중문폭 1,000 mm", textX: 1340, textZ: 5955, textY: 0.05, direction: 'x' },
        { x1: 1840, z1: 5955, y1: 0.05, x2: 2425, z2: 5955, y2: 0.05, label: "방문이격 585 mm", textX: 2132.5, textZ: 5955, textY: 0.05, direction: 'x' },
        { x1: 2425, z1: 5955, y1: 0.05, x2: 2540, z2: 5955, y2: 0.05, label: "문틀 115 mm", textX: 2482.5, textZ: 5955, textY: 0.05, direction: 'x' },
        { x1: 2540, z1: 5955, y1: 0.05, x2: 3440, z2: 5955, y2: 0.05, label: "방문폭 900 mm", textX: 2990, textZ: 5955, textY: 0.05, direction: 'x' },
        { x1: 3440, z1: 5955, y1: 0.05, x2: 3540, z2: 5955, y2: 0.05, label: "유격 100 mm", textX: 3490, textZ: 5955, textY: 0.05, direction: 'x' },

        // --- 4. 주방 및 세탁실(발코니2) 실측 치수 가이드 ---
        { x1: 3650, z1: 11050, y1: 0.05, x2: 7000, z2: 11050, y2: 0.05, label: "주방 북쪽 3,350 mm", textX: 5325, textZ: 11050, textY: 0.05, direction: 'x' },
        
        // 4.1 북측 하부 가구 개별 도어 분할 (Y=0.5m 선상에 위치)
        { x1: 3650, z1: 10900, y1: 0.5, x2: 4100, z2: 10900, y2: 0.5, label: "하단장1 450 mm", textX: 3875, textZ: 10900, textY: 0.5, direction: 'x' },
        { x1: 4100, z1: 10900, y1: 0.5, x2: 4650, z2: 10900, y2: 0.5, label: "하단장2 550 mm", textX: 4375, textZ: 10900, textY: 0.5, direction: 'x' },
        { x1: 4650, z1: 10900, y1: 0.5, x2: 5200, z2: 10900, y2: 0.5, label: "하단장3 550 mm", textX: 4925, textZ: 10900, textY: 0.5, direction: 'x' },
        { x1: 5200, z1: 10900, y1: 0.5, x2: 5800, z2: 10900, y2: 0.5, label: "하단장4 600 mm", textX: 5500, textZ: 10900, textY: 0.5, direction: 'x' },
        { x1: 5800, z1: 10900, y1: 0.5, x2: 6200, z2: 10900, y2: 0.5, label: "하단장5 400 mm", textX: 6000, textZ: 10900, textY: 0.5, direction: 'x' },
        { x1: 6200, z1: 10900, y1: 0.5, x2: 6300, z2: 10900, y2: 0.5, label: "필러 100 mm", textX: 6250, textZ: 10900, textY: 0.5, direction: 'x' },
        { x1: 6300, z1: 10900, y1: 0.5, x2: 7000, z2: 10900, y2: 0.5, label: "코너 700 mm", textX: 6650, textZ: 10900, textY: 0.5, direction: 'x' },

        // 4.2 북측 상부 가구 개별 분할 (Y=1.6m 선상에 위치)
        { x1: 3650, z1: 11000, y1: 1.6, x2: 4150, z2: 11000, y2: 1.6, label: "상단장L 500 mm", textX: 3900, textZ: 11000, textY: 1.6, direction: 'x' },
        { x1: 4150, z1: 11000, y1: 1.6, x2: 5350, z2: 11000, y2: 1.6, label: "창문 1200 mm", textX: 4750, textZ: 11000, textY: 1.6, direction: 'x' },
        { x1: 5350, z1: 11000, y1: 1.6, x2: 6680, z2: 11000, y2: 1.6, label: "상단장R 1330 mm", textX: 6015, textZ: 11000, textY: 1.6, direction: 'x' },
        { x1: 6680, z1: 11000, y1: 1.6, x2: 7000, z2: 11000, y2: 1.6, label: "코너마감 320 mm", textX: 6840, textZ: 11000, textY: 1.6, direction: 'x' },

        // 4.3 우측 하부 가구 개별 분할 (Y=0.5m, Z축 정렬)
        { x1: 6900, z1: 10350, y1: 0.5, x2: 6900, z2: 11050, y2: 0.5, label: "코너 700 mm", textX: 6900, textZ: 10700, textY: 0.5, direction: 'z' },
        { x1: 6900, z1: 10150, y1: 0.5, x2: 6900, z2: 10350, y2: 0.5, label: "하단장1 200 mm", textX: 6900, textZ: 10250, textY: 0.5, direction: 'z' },
        { x1: 6900, z1: 9550, y1: 0.5, x2: 6900, z2: 10150, y2: 0.5, label: "하단장2 600 mm", textX: 6900, textZ: 9850, textY: 0.5, direction: 'z' },
        { x1: 6900, z1: 9250, y1: 0.5, x2: 6900, z2: 9550, y2: 0.5, label: "하단장3 300 mm", textX: 6900, textZ: 9400, textY: 0.5, direction: 'z' },
        { x1: 6900, z1: 8950, y1: 0.5, x2: 6900, z2: 9250, y2: 0.5, label: "하단장4 300 mm", textX: 6900, textZ: 9100, textY: 0.5, direction: 'z' },

        // 4.4 우측 상부 가구 개별 분할 (Y=1.6m, Z축 정렬)
        { x1: 6950, z1: 10750, y1: 1.6, x2: 6950, z2: 11050, y2: 1.6, label: "코너 300 mm", textX: 6950, textZ: 10900, textY: 1.6, direction: 'z' },
        { x1: 6950, z1: 10300, y1: 1.6, x2: 6950, z2: 10750, y2: 1.6, label: "상단장1 450 mm", textX: 6950, textZ: 10525, textY: 1.6, direction: 'z' },
        { x1: 6950, z1: 9850, y1: 1.6, x2: 6950, z2: 10300, y2: 1.6, label: "상단장2(후드) 450 mm", textX: 6950, textZ: 10075, textY: 1.6, direction: 'z' },
        { x1: 6950, z1: 9400, y1: 1.6, x2: 6950, z2: 9850, y2: 1.6, label: "상단장3 450 mm", textX: 6950, textZ: 9625, textY: 1.6, direction: 'z' },
        { x1: 6950, z1: 8950, y1: 1.6, x2: 6950, z2: 9400, y2: 1.6, label: "상단장4 450 mm", textX: 6950, textZ: 9175, textY: 1.6, direction: 'z' },

        // 4.5 냉장고장 및 마감 격벽 (Z축 정렬)
        { x1: 7000, z1: 7900, y1: 0.05, x2: 7000, z2: 8950, y2: 0.05, label: "냉장고장 가로 1,050 mm", textX: 7000, textZ: 8425, textY: 0.05, direction: 'z' },
        { x1: 6300, z1: 8600, y1: 0.05, x2: 7000, z2: 8600, y2: 0.05, label: "냉장고장 깊이 700 mm", textX: 6650, textZ: 8600, textY: 0.05, direction: 'x' },
        { x1: 7000, z1: 7580, y1: 0.05, x2: 7000, z2: 7900, y2: 0.05, label: "우측기둥 320 mm", textX: 7000, textZ: 7740, textY: 0.05, direction: 'z' },

        // 4.6 발코니2 (다용도실 및 세탁실) 실측 치수 가이드 신설
        { x1: 1450, z1: 10000, y1: 0.05, x2: 3650, z2: 10000, y2: 0.05, label: "발코니2 가로 2,200 mm", textX: 2550, textZ: 10000, textY: 0.05, direction: 'x' },
        { x1: 1550, z1: 9060, y1: 0.05, x2: 1550, z2: 11170, y2: 0.05, label: "발코니2 세로 2,110 mm", textX: 1550, textZ: 10115, textY: 0.05, direction: 'z' },
        { x1: 1590, z1: 9170, y1: 0, x2: 1590, z2: 9170, y2: 1.2, label: "세탁수전고 1,200 mm", textX: 1590, textZ: 9170, textY: 0.6, direction: 'y' },
        { x1: 1380, z1: 9170, y1: 0, x2: 1380, z2: 9170, y2: 1.42, label: "콘센트하단 1,420 mm", textX: 1380, textZ: 9170, textY: 0.71, direction: 'y' },
        { x1: 1380, z1: 9170, y1: 1.54, x2: 1380, z2: 9170, y2: 1.71, label: "기기간격 170 mm", textX: 1380, textZ: 9170, textY: 1.625, direction: 'y' },
        { x1: 1380, z1: 9170, y1: 1.83, x2: 1380, z2: 9170, y2: 2.3, label: "상단간격 470 mm", textX: 1380, textZ: 9170, textY: 2.065, direction: 'y' },
        { x1: 3650, z1: 10500, y1: 0, x2: 3650, z2: 10500, y2: 1.63, label: "계량기하단고 1,630 mm", textX: 3650, textZ: 10500, textY: 0.815, direction: 'y', isPanelOffset: true },
        { x1: 3650, z1: 9060, y1: 0.05, x2: 3650, z2: 9290, y2: 0.05, label: "문좌측벽 230 mm", textX: 3650, textZ: 9175, textY: 0.05, direction: 'z' },
        { x1: 3650, z1: 9290, y1: 0.05, x2: 3650, z2: 10190, y2: 0.05, label: "터닝도어 900 mm", textX: 3650, textZ: 9740, textY: 0.05, direction: 'z' },
        { x1: 3650, z1: 10190, y1: 0.05, x2: 3650, z2: 10410, y2: 0.05, label: "문우측벽 220 mm", textX: 3650, textZ: 10300, textY: 0.05, direction: 'z' },
        { x1: 1450, z1: 11170, y1: 0.05, x2: 1680, z2: 11170, y2: 0.05, label: "창좌측벽 230 mm", textX: 1565, textZ: 11170, textY: 0.05, direction: 'x' },
        { x1: 1680, z1: 11170, y1: 0.05, x2: 2580, z2: 11170, y2: 0.05, label: "창문폭 900 mm", textX: 2130, textZ: 11170, textY: 0.05, direction: 'x' },
        { x1: 2580, z1: 11170, y1: 0.05, x2: 2760, z2: 11170, y2: 0.05, label: "창우측벽 180 mm", textX: 2670, textZ: 11170, textY: 0.05, direction: 'x' }
    ];
    
    guides.forEach(g => {
        let x1 = getWorldX(g.x1);
        let z1 = getWorldZ(g.z1);
        let x2 = getWorldX(g.x2);
        let z2 = getWorldZ(g.z2);
        let textX = getWorldX(g.textX);
        let textZ = getWorldZ(g.textZ);
        
        if (g.isPanelOffset) {
            const wallT = wallThickness * MM_TO_UNIT;
            x1 += wallT / 2 + 0.01;
            x2 += wallT / 2 + 0.01;
            textX += wallT / 2 + 0.01;
        }
        
        const y1 = g.y1;
        const y2 = g.y2;
        
        const pts = [new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2, z2)];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, lineMat);
        line.renderOrder = 999;
        // 치수 가이드라인 중심점 지정
        line.userData = line.userData || {};
        line.userData.center = new THREE.Vector3((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
        bedroom2DimGroup.add(line);
        
        const tickLen = 0.08;
        const drawTick = (px, py, pz) => {
            let ptsTick = [];
            if (g.direction === 'x') {
                ptsTick = [new THREE.Vector3(px, py, pz - tickLen), new THREE.Vector3(px, py, pz + tickLen)];
            } else if (g.direction === 'z') {
                ptsTick = [new THREE.Vector3(px - tickLen, py, pz), new THREE.Vector3(px + tickLen, py, pz)];
            } else if (g.direction === 'y') {
                ptsTick = [new THREE.Vector3(px, py, pz - tickLen), new THREE.Vector3(px, py, pz + tickLen)];
            }
            const tickGeo = new THREE.BufferGeometry().setFromPoints(ptsTick);
            const tickLine = new THREE.Line(tickGeo, tickMat);
            tickLine.renderOrder = 999;
            // 눈금선 중심점 지정
            tickLine.userData = tickLine.userData || {};
            tickLine.userData.center = new THREE.Vector3(px, py, pz);
            bedroom2DimGroup.add(tickLine);
        };
        
        drawTick(x1, y1, z1);
        drawTick(x2, y2, z2);
        
        const container = document.getElementById('room-labels-container');
        if (container) {
            const div = document.createElement('div');
            div.className = 'bedroom2-dim-label';
            div.innerText = g.label;
            
            div.dataset.x = textX;
            div.dataset.y = g.textY;
            div.dataset.z = textZ;
            
            container.appendChild(div);
        }
    });
    
    scene.add(bedroom2DimGroup);
}
