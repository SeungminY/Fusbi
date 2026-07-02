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
const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

// 도면 전체 크기 (침실2 실측 보정 후 가로 10050mm, 세로 10000mm)
const PLAN_WIDTH = 10050;
const PLAN_DEPTH = 10000;
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
const offsetX = -PLAN_WIDTH * 0.5 * MM_TO_UNIT; // -5.025
const offsetZ = -PLAN_DEPTH * 0.5 * MM_TO_UNIT; // -5.0

// 도면 상 X -> 3D X
function getWorldX(x_mm) {
    return x_mm * MM_TO_UNIT + offsetX;
}

// 도면 상 Z -> 3D Z: 북측(-Z, 화면 위), 남측(+Z, 화면 아래)
function getWorldZ(z_mm) {
    return (PLAN_DEPTH * 0.5 - z_mm) * MM_TO_UNIT;
}

// --- 49A형 아파트 구역(방) 데이터 설계 (침실2 실측치수 및 우측외벽 10050mm 보정 적용) ---
const ROOMS_DATA = [
    { id: 'utility', name: '실외기실', x: 0, z: 0, w: 1730, d: 1650, floorPreset: 'dark' },
    { id: 'balcony1', name: '발코니1', x: 1730, z: 0, w: 1800, d: 1650, floorPreset: 'tile' },
    { id: 'bedroom1', name: '침실1', x: 0, z: 1650, w: 3530, d: 3235, floorPreset: 'wood' },
    { id: 'passage', name: '통로/반침', x: 0, z: 4885, w: 3530, d: 1225, floorPreset: 'wood' }, 
    { id: 'bath', name: '욕실', x: 0, z: 6110, w: 2305, d: 1780, floorPreset: 'tile' },
    { id: 'balcony2', name: '발코니2', x: 0, z: 8640, w: 2415, d: 1360, floorPreset: 'tile' },
    { id: 'kitchen', name: '주방/식당', x: 2415, z: 6110, w: 4935, d: 3890, floorPreset: 'tile' },
    { id: 'living', name: '거실', x: 3530, z: 0, w: 3820, d: 6110, floorPreset: 'wood' },
    { id: 'bedroom2', name: '침실2', x: 7350, z: 0, w: 2700, d: 3450, floorPreset: 'bedroom2_wood' }, // 실측 2700x3450 반영
    { id: 'entrance', name: '현관', x: 7350, z: 3450, w: 2700, d: 1290, floorPreset: 'tile' } // 침실2 상단 Z=3450 경계로 현관 시작점 보정
];

// --- 벽체 세그먼트 데이터 설계 (침실2 및 현관 역계산 보정 적용) ---
const WALL_SEGMENTS = [
    // 1. 가로 벽체들 (z1 == z2)
    { x1: 0, z1: 0, x2: 7350, z2: 0, hasDoor: false }, // 침실1/거실 남측 외벽 구간
    { x1: 7350, z1: 0, x2: 7650, z2: 0, hasDoor: false }, // 침실2 남측 우측 가벽 30cm
    { x1: 7650, z1: 0, x2: 9350, z2: 0, hasWindow: true, winMinY: 1130, winMaxY: 2230 }, // 침실2 남측 창문 구간 (바닥 1.13m, 높이 1.1m)
    { x1: 9350, z1: 0, x2: 10050, z2: 0, hasDoor: false }, // 침실2 남측 좌측 가벽 70cm
    { x1: 0, z1: 1650, x2: 3530, z2: 1650, hasDoor: true, doorPos: 2400, doorWidth: 900 }, // 침실1 - 발코니1 경계
    { x1: 7350, z1: 3450, x2: 10050, z2: 3450, hasDoor: true, doorPos: 7500, doorWidth: 900 }, // 침실2 북측 벽 및 방문 (Z=3450으로 보정)
    { x1: 0, z1: 4885, x2: 3530, z2: 4885, hasDoor: true, doorPos: 2300, doorWidth: 900 }, // 침실1 북측 벽 및 방문
    { x1: 7350, z1: 4740, x2: 10050, z2: 4740, hasDoor: true, doorPos: 8000, doorWidth: 1000 }, // 현관 북측 가로벽 및 현관 방화문 (Z=4740으로 보정)
    { x1: 0, z1: 6110, x2: 2305, z2: 6110, hasDoor: true, doorPos: 1200, doorWidth: 900 }, // 욕실 남측 벽
    { x1: 0, z1: 7890, x2: 2305, z2: 7890, hasDoor: false }, // 욕실 북측 벽
    { x1: 0, z1: 8640, x2: 2415, z2: 8640, hasDoor: false }, // 발코니2 남측 벽
    { x1: 0, z1: 10000, x2: 7350, z2: 10000, hasDoor: false }, // 북측 외벽 전체

    // 2. 세로 벽체들 (x1 == x2)
    { x1: 0, z1: 0, x2: 0, z2: 10000, hasDoor: false }, // 서측 외벽 전체
    { x1: 1730, z1: 0, x2: 1730, z2: 1650, hasDoor: true, doorPos: 400, doorWidth: 800 }, // 실외기실 격벽
    { x1: 2305, z1: 6110, x2: 2305, z2: 7890, hasDoor: false }, // 욕실 동측 벽
    { x1: 2415, z1: 8640, x2: 2415, z2: 10000, hasDoor: false }, // 발코니2 동측 벽
    { x1: 3530, z1: 0, x2: 3530, z2: 4885, hasDoor: false }, // 거실 - 침실1 경계 세로벽
    { x1: 7350, z1: 0, x2: 7350, z2: 3450, hasDoor: false }, // 거실 - 침실2 경계 세로벽 (Z=3450까지)
    { x1: 7350, z1: 4740, x2: 7350, z2: 10000, hasDoor: false }, // 주방 - 현관 경계 세로벽 (Z=4740부터 시작)
    { x1: 10050, z1: 0, x2: 10050, z2: 4740, hasDoor: false } // 침실2 및 현관 동측 외벽 정렬선 (X=10050으로 당김)
];

// --- 외부 치수선 설계 데이터 (침실2/현관 가로 10050mm 역계산 반영) ---
const DIMENSION_SEGMENTS = [
    // 1. 하단 외부 가로 치수선 (Z = -800mm 외각 정렬)
    { x1: 0, z1: -800, x2: 3530, z2: -800, label: '3,530 mm', textX: 1765, textZ: -800, refX1: 0, refZ1: 0, refX2: 3530, refZ2: 0 },
    { x1: 3530, z1: -800, x2: 7350, z2: -800, label: '3,820 mm', textX: 5440, textZ: -800, refX1: 3530, refZ1: 0, refX2: 7350, refZ2: 0 },
    { x1: 7350, z1: -800, x2: 10050, z2: -800, label: '2,700 mm', textX: 8700, textZ: -800, refX1: 7350, refZ1: 0, refX2: 10050, refZ2: 0 }, // 실측 2700
    // 하단 전체 가로 치수선 (Z = -1400mm)
    { x1: 0, z1: -1400, x2: 10050, z2: -1400, label: '10,050 mm', textX: 5025, textZ: -1400, refX1: 0, refZ1: 0, refX2: 10050, refZ2: 0 },

    // 2. 상단 외부 가로 치수선 (Z = 10800mm)
    { x1: 0, z1: 10800, x2: 2415, z2: 10800, label: '2,415 mm', textX: 1207, textZ: 10800, refX1: 0, refZ1: 10000, refX2: 2415, refZ2: 10000 },
    { x1: 2415, z1: 10800, x2: 7350, z2: 10800, label: '4,935 mm', textX: 4882, textZ: 10800, refX1: 2415, refZ1: 10000, refX2: 7350, refZ2: 10000 },

    // 3. 좌측 외부 세로 치수선 (X = -800mm)
    { x1: -800, z1: 0, x2: -800, z2: 1650, label: '1,650 mm', textX: -800, textZ: 825, refX1: 0, refZ1: 0, refX2: 0, refZ2: 1650 },
    { x1: -800, z1: 1650, x2: -800, z2: 4885, label: '3,235 mm', textX: -800, textZ: 3267, refX1: 0, refZ1: 1650, refX2: 0, refZ2: 4885 },
    { x1: -800, z1: 4885, x2: -800, z2: 6110, label: '1,225 mm', textX: -800, textZ: 5497, refX1: 0, refZ1: 4885, refX2: 0, refZ2: 6110 },
    { x1: -800, z1: 6110, x2: -800, z2: 7890, label: '1,780 mm', textX: -800, textZ: 7000, refX1: 0, refZ1: 6110, refX2: 0, refZ2: 7890 },
    { x1: -800, z1: 7890, x2: -800, z2: 8640, label: '750 mm', textX: -800, textZ: 8265, refX1: 0, refZ1: 7890, refX2: 0, refZ2: 8640 },
    { x1: -800, z1: 8640, x2: -800, z2: 10000, label: '1,360 mm', textX: -800, textZ: 9320, refX1: 0, refZ1: 8640, refX2: 0, refZ2: 10000 },
    // 좌측 전체 세로 치수선 (X = -1400mm)
    { x1: -1400, z1: 0, x2: -1400, z2: 10000, label: '10,000 mm', textX: -1400, textZ: 5000, refX1: 0, refZ1: 0, refX2: 0, refZ2: 10000 },

    // 4. 우측 외부 세로 치수선들 (X = 10850mm로 당김)
    { x1: 10850, z1: 0, x2: 10850, z2: 3450, label: '3,450 mm', textX: 10850, textZ: 1725, refX1: 10050, refZ1: 0, refX2: 10050, refZ2: 3450 }, // 실측 3450
    { x1: 10850, z1: 3450, x2: 10850, z2: 4740, label: '1,290 mm', textX: 10850, textZ: 4095, refX1: 10050, refZ1: 3450, refX2: 10050, refZ2: 4740 }
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
    initCatalog();
    initUIEventListeners();
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
    container.appendChild(renderer.domElement);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);
    
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.25);
    hemiLight.position.set(0, 10, 0);
    scene.add(hemiLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.75);
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

    const pointLight1 = new THREE.PointLight(0xfff8e7, 0.35, 20);
    pointLight1.position.set(-3, 4, -3);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xe7f0ff, 0.25, 20);
    pointLight2.position.set(3, 4, 3);
    scene.add(pointLight2);
    
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
    ctxW.fillStyle = '#dfaf74';
    ctxW.fillRect(0, 0, 512, 512);
    ctxW.strokeStyle = '#c6955a';
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
    ctxB2.fillStyle = '#e8e2d7'; // 실제 사진의 밝은 베이지/화이트 우드 바닥톤 매핑
    ctxB2.fillRect(0, 0, 512, 512);
    ctxB2.strokeStyle = '#d9d0c2'; // 부드럽고 얇은 줄눈
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
    
    // 은은한 나무결 표현
    ctxB2.fillStyle = 'rgba(255, 255, 255, 0.2)';
    for (let i = 0; i < 500; i++) {
        ctxB2.fillRect(Math.random()*512, Math.random()*512, Math.random()*80+20, 1.5);
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
    ctxT.fillStyle = '#e5e7eb';
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
        
        const floorMat = new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.5,
            metalness: 0.05
        });
        
        if (tex) {
            tex.repeat.set(rw * 2, rd * 2);
        }
        
        const floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        
        const posX = getWorldX(room.x + room.w / 2);
        const posZ = getWorldZ(room.z + room.d / 2);
        floorMesh.position.set(posX, 0, posZ);
        floorMesh.receiveShadow = true;
        
        floorMesh.userData = { roomId: room.id, name: room.name };
        scene.add(floorMesh);
        roomFloors.push(floorMesh);
    });

    // 2. 아파트 전체 격자 헬퍼 그리드 추가
    const gridHelper = new THREE.GridHelper(15, 30, 0x6366f1, 0x334155);
    gridHelper.position.set(0, 0.001, 0);
    gridHelper.material.opacity = 0.15;
    gridHelper.material.transparent = true;
    gridHelper.name = "gridHelper";
    
    const oldGrid = scene.getObjectByName("gridHelper");
    if (oldGrid) scene.remove(oldGrid);
    scene.add(gridHelper);

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
        if (seg.hasDoor) {
            const dStart = seg.doorPos;
            const dW = seg.doorWidth;
            const dEnd = dStart + dW;
            
            if (seg.x1 === seg.x2) {
                if (dStart > seg.z1) {
                    createWallMeshFromSegment(seg.x1, seg.z1, seg.x2, dStart, t, h, 0, wallMat);
                }
                createWallMeshFromSegment(seg.x1, dStart, seg.x2, dEnd, t, 200 * MM_TO_UNIT, 2100 * MM_TO_UNIT, wallMat);
                if (seg.z2 > dEnd) {
                    createWallMeshFromSegment(seg.x1, dEnd, seg.x2, seg.z2, t, h, 0, wallMat);
                }
            } else {
                if (dStart > seg.x1) {
                    createWallMeshFromSegment(seg.x1, seg.z1, dStart, seg.z2, t, h, 0, wallMat);
                }
                createWallMeshFromSegment(dStart, seg.z1, dEnd, seg.z2, t, 200 * MM_TO_UNIT, 2100 * MM_TO_UNIT, wallMat);
                if (seg.x2 > dEnd) {
                    createWallMeshFromSegment(dEnd, seg.z1, seg.x2, seg.z2, t, h, 0, wallMat);
                }
            }
        } else if (seg.hasWindow) {
            const winMin = seg.winMinY * MM_TO_UNIT; 
            const winMax = seg.winMaxY * MM_TO_UNIT; 
            const totalH = WALL_HEIGHT * MM_TO_UNIT; 
            
            // 1. 창문 하부 벽 (Y = 0 ~ winMin)
            createWallMeshFromSegment(seg.x1, seg.z1, seg.x2, seg.z2, t, winMin, 0, wallMat);
            
            // 2. 창문 상부 인방 벽 (Y = winMax ~ totalH)
            const topH = totalH - winMax; 
            createWallMeshFromSegment(seg.x1, seg.z1, seg.x2, seg.z2, t, topH, winMax, wallMat);
        } else {
            createWallMeshFromSegment(seg.x1, seg.z1, seg.x2, seg.z2, t, h, 0, wallMat);
        }
    });

    // 침실2 정밀 실사 모사 구성물 배치 실행
    buildBedroom2Details();

    buildRoomLabelsDOM();
    updateRoomLabels();
    updateWallsVisibility();
}

function createWallMeshFromSegment(x1, z1, x2, z2, thickness, height, elevation, material) {
    const wx1 = getWorldX(x1);
    const wz1 = getWorldZ(z1);
    const wx2 = getWorldX(x2);
    const wz2 = getWorldZ(z2);
    
    const dx = wx2 - wx1;
    const dz = wz2 - wz1;
    const len = Math.sqrt(dx * dx + dz * dz);
    const ang = Math.atan2(dz, dx);
    
    const wallGeo = new THREE.BoxGeometry(len, height, thickness);
    const matCopy = material.clone();
    if (matCopy.map) {
        matCopy.map.repeat.set(len * 2, height * 2);
    }
    
    const wallMesh = new THREE.Mesh(wallGeo, matCopy);
    
    const cx = wx1 + dx / 2;
    const cz = wz1 + dz / 2;
    const cy = (height / 2) + elevation;
    
    wallMesh.position.set(cx, cy, cz);
    wallMesh.rotation.y = -ang; 
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    
    scene.add(wallMesh);
    roomWalls.push(wallMesh);
}

// --- 침실2 실사 기반 내부 장치 3D 렌더링 알고리즘 ---
function buildBedroom2Details() {
    // 기존에 있던 침실2 관련 정밀 묘사 메시 삭제
    detailObjects.forEach(obj => scene.remove(obj));
    detailObjects = [];

    const matWhite = new THREE.MeshStandardMaterial({ color: 0xfcfcfc, roughness: 0.8, metalness: 0.05 });
    const matBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.1 });
    const matGlass = new THREE.MeshStandardMaterial({ color: 0xb2cdd4, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.35 });
    const matGray = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.5, metalness: 0.3 }); // 전기 콘센트 플레이트 색
    const matSkirting = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.9, metalness: 0.02 }); // 걸레받이 색상 (웜화이트)

    // 1. 빌트인 시스템 에어컨 (남쪽 창문 위 천장 묘사)
    // 가로: 1.2m, 세로: 0.45m, 두께: 0.02m
    const acGroup = new THREE.Group();
    const acBodyGeo = new THREE.BoxGeometry(1.2, 0.02, 0.45);
    const acBody = new THREE.Mesh(acBodyGeo, matWhite);
    acGroup.add(acBody);

    // 날개 홈 무늬
    const acBladeGeo = new THREE.BoxGeometry(1.0, 0.005, 0.08);
    const acBlade = new THREE.Mesh(acBladeGeo, matGray);
    acBlade.position.set(0, -0.008, 0.1);
    acGroup.add(acBlade);

    // 에어컨 위치: 남측벽(Z=0) 창문 위 천장 (Y=2.29), 방 내부 방향으로 Z=300 만큼 들어옴
    acGroup.position.set(getWorldX(7350 + 300 + 850), 2.29, getWorldZ(300));
    scene.add(acGroup);
    detailObjects.push(acGroup);

    // 2. 심플 원형 LED 천장 면조명 & 광원 추가
    const lightGroup = new THREE.Group();
    const ledGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 32);
    // 자체 발광 머티리얼 적용
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const ledMesh = new THREE.Mesh(ledGeo, ledMat);
    lightGroup.add(ledMesh);

    // LED 등 위치: 방 중앙 (X=7350+1350, Z=1725, Y=2.3)
    const ledX = 7350 + 1350;
    const ledZ = 1725;
    lightGroup.position.set(getWorldX(ledX), 2.27, getWorldZ(ledZ));
    
    // 실제 방 안을 은은하게 밝히는 주백색 PointLight 설치
    const roomLight = new THREE.PointLight(0xfffdf4, 0.55, 12);
    roomLight.position.set(0, -0.2, 0); // 등 밑에서 빛 방출
    roomLight.castShadow = true;
    roomLight.shadow.bias = -0.0002;
    lightGroup.add(roomLight);

    scene.add(lightGroup);
    detailObjects.push(lightGroup);

    // 3. 방문 무광 블랙(매트 블랙) 레버 손잡이 (경첩 피벗 회전 그룹화)
    doorPivot = new THREE.Group();
    doorPivot.name = "bedroom2_door_pivot";
    // 경첩 위치: 벽체 Z=3450 상의 X=7500 (방문의 서측 끝)
    doorPivot.position.set(getWorldX(7500), 0, getWorldZ(3450));
    
    // 기본적으로 문을 방 안쪽(남쪽)으로 85도 열어둠 (방향 부호 음수로 반전)
    isDoorOpen = true;
    doorPivot.rotation.y = -Math.PI * 0.47; 

    // 방문짝 메쉬 생성 (로컬 기준 문짝의 중심은 X = 0.45, Y = 1.05 이 됨)
    const doorPanelGeo = new THREE.BoxGeometry(0.9, 2.1, 0.04);
    const doorPanel = new THREE.Mesh(doorPanelGeo, matWhite);
    doorPanel.name = "bedroom2_door_panel";
    doorPanel.position.set(0.45, 1.05, 0); // 경첩에서 우측으로 45cm 민 중심점
    doorPivot.add(doorPanel);
    
    // L자형 매트 블랙 문손잡이 제작
    const handleGroup = new THREE.Group();
    // 둥근 로제트(원반)
    const rosetteGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.006, 16);
    rosetteGeo.rotateX(Math.PI / 2);
    const rosette = new THREE.Mesh(rosetteGeo, matBlack);
    handleGroup.add(rosette);

    // 손잡이 레버축 및 L자 실린더
    const barGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.04, 16);
    barGeo.rotateX(Math.PI / 2);
    const bar = new THREE.Mesh(barGeo, matBlack);
    bar.position.set(0, 0, 0.02);
    handleGroup.add(bar);

    const leverGeo = new THREE.BoxGeometry(0.12, 0.012, 0.02);
    const lever = new THREE.Mesh(leverGeo, matBlack);
    // 실제 사진상 문이 열리는 오른쪽(동쪽)에 손잡이가 있으며, 레버는 왼쪽(경첩 방향)을 향함
    lever.position.set(-0.05, 0, 0.04);
    handleGroup.add(lever);

    // 손잡이 문짝에 결합 (문짝 중심 0.45 기준, 오른쪽 끝 근처인 로컬 X = 0.38 지점에 부착)
    handleGroup.position.set(0.38, -0.05, 0.025);
    doorPanel.add(handleGroup);

    // 문 뒷면(복도쪽) 손잡이도 동일 결합 (Y회전 180도로 레버 방향 매칭)
    const handleBack = handleGroup.clone();
    handleBack.position.z = -0.025;
    handleBack.rotation.y = Math.PI;
    doorPanel.add(handleBack);

    scene.add(doorPivot);
    detailObjects.push(doorPivot);

    // 4. 벽면 온도조절기 & 스위치 플레이트 (방문 우측 가벽 Z = 3450 상의 X = 8670, 높이 112cm)
    const switchGroup = new THREE.Group();
    // 온도조절기 (검은색 콤팩트 박스)
    const thermostatGeo = new THREE.BoxGeometry(0.08, 0.08, 0.005);
    const thermostat = new THREE.Mesh(thermostatGeo, matBlack);
    thermostat.position.set(0, 0.08, 0.005);
    switchGroup.add(thermostat);

    // 전기 스위치 (실버/그레이 플레이트)
    const wallSwitchGeo = new THREE.BoxGeometry(0.07, 0.12, 0.005);
    const wallSwitch = new THREE.Mesh(wallSwitchGeo, matGray);
    wallSwitch.position.set(0, -0.04, 0.005);
    switchGroup.add(wallSwitch);

    // 방 내부 벽면 쪽에 밀착되도록 Z축 좌표 보정
    switchGroup.position.set(getWorldX(8670), 1.12, getWorldZ(3450) + (wallThickness*MM_TO_UNIT)/2 + 0.002);
    scene.add(switchGroup);
    detailObjects.push(switchGroup);

    // 5. 방문 좌측벽 분전반/배전함 커버 2종 (방 내부 좌측벽 X = 7350, Z = 2800 부근)
    const panelGroup = new THREE.Group();
    // 상단 단자함 (정사각형 30x30cm)
    const box1Geo = new THREE.BoxGeometry(0.005, 0.3, 0.3);
    const box1 = new THREE.Mesh(box1Geo, matWhite);
    box1.position.set(0.002, 1.6, 0);
    panelGroup.add(box1);

    // 하단 단자함 (직사각형 30x45cm)
    const box2Geo = new THREE.BoxGeometry(0.005, 0.45, 0.3);
    const box2 = new THREE.Mesh(box2Geo, matWhite);
    box2.position.set(0.002, 0.9, 0);
    panelGroup.add(box2);

    panelGroup.position.set(getWorldX(7350) + (wallThickness*MM_TO_UNIT)/2, 0, getWorldZ(2800));
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

    // 남쪽 벽면(Z=0)의 우측 구석(서쪽 X=7350 부근): 서쪽에서 35cm 띔
    createOutlet(getWorldX(7350 + 350), 0.3, getWorldZ(0) + (wallThickness*MM_TO_UNIT)/2 + 0.002, Math.PI);
    // 남쪽 벽면(Z=0)의 좌측 구석(동쪽 X=10050 부근): 동쪽에서 15cm 띔
    createOutlet(getWorldX(10050 - 150), 0.3, getWorldZ(0) + (wallThickness*MM_TO_UNIT)/2 + 0.002, Math.PI);
    // 북쪽 벽면(Z=3450) 방문 우측 스위치 하단
    createOutlet(getWorldX(8670), 0.3, getWorldZ(3450) + (wallThickness*MM_TO_UNIT)/2 + 0.002, 0);

    // 7. 창문 (남측 Z=0 벽의 가로 X=7350~10050 사이 1700폭 창문 묘사)
    // 실제 사진의 비대칭 매치: 서쪽(X=7350)에서 30cm, 동쪽(X=10050)에서 70cm 띄움
    const windowGroup = new THREE.Group();
    // 창틀 프레임 (화이트)
    const frameGeo = new THREE.BoxGeometry(1.7, 1.1, 0.12);
    const windowFrame = new THREE.Mesh(frameGeo, matWhite);
    windowGroup.add(windowFrame);
    
    // 창문 내부 유리창 (두 개 분할 슬라이딩 샷시)
    const glass1 = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.98, 0.03), matGlass);
    glass1.position.set(-0.4, 0, -0.02);
    windowGroup.add(glass1);

    const glass2 = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.98, 0.03), matGlass);
    glass2.position.set(0.4, 0, 0.02);
    windowGroup.add(glass2);

    // 남쪽 외벽선 Z=0 에 밀착하여 배치
    windowGroup.position.set(getWorldX(7350 + 300 + 850), (1.1/2) + 1.13, getWorldZ(0));
    scene.add(windowGroup);
    detailObjects.push(windowGroup);

    // 8. 바닥 테두리 웜화이트 걸레받이(Skirting/Baseboard) 추가
    const skirtThick = 0.01; // 1cm 두께
    const skirtHeight = 0.06; // 6cm 높이
    const wallT = wallThickness * MM_TO_UNIT;

    // 8.1 남쪽 걸레받이 (Z=0, 전체 폭 2.7m)
    const skirtSGeo = new THREE.BoxGeometry(2.7, skirtHeight, skirtThick);
    const skirtS = new THREE.Mesh(skirtSGeo, matSkirting);
    skirtS.position.set(getWorldX(7350 + 1350), skirtHeight/2, getWorldZ(0) + wallT/2 + skirtThick/2);
    scene.add(skirtS);
    detailObjects.push(skirtS);

    // 8.2 북쪽 걸레받이 (Z=3450, 방문 개구부 X=7450~8470 제외)
    // 서쪽 틈새 (X = 7350 ~ 7450, 폭 0.1m)
    const skirtNWGeo = new THREE.BoxGeometry(0.1, skirtHeight, skirtThick);
    const skirtNW = new THREE.Mesh(skirtNWGeo, matSkirting);
    skirtNW.position.set(getWorldX(7350 + 50), skirtHeight/2, getWorldZ(3450) + wallT/2 + skirtThick/2);
    scene.add(skirtNW);
    detailObjects.push(skirtNW);

    // 동쪽 틈새 (X = 8470 ~ 10050, 폭 1.58m)
    const skirtNEGeo = new THREE.BoxGeometry(1.58, skirtHeight, skirtThick);
    const skirtNE = new THREE.Mesh(skirtNEGeo, matSkirting);
    skirtNE.position.set(getWorldX(8470 + 790), skirtHeight/2, getWorldZ(3450) + wallT/2 + skirtThick/2);
    scene.add(skirtNE);
    detailObjects.push(skirtNE);

    // 8.3 서쪽 걸레받이 (X=7350, 전체 세로 폭 3.45m)
    const skirtWGeo = new THREE.BoxGeometry(3.45, skirtHeight, skirtThick);
    const skirtW = new THREE.Mesh(skirtWGeo, matSkirting);
    skirtW.rotation.y = Math.PI / 2;
    skirtW.position.set(getWorldX(7350) + wallT/2 + skirtThick/2, skirtHeight/2, getWorldZ(1725));
    scene.add(skirtW);
    detailObjects.push(skirtW);

    // 8.4 동쪽 걸레받이 (X=10050, 전체 세로 폭 3.45m)
    const skirtEGeo = new THREE.BoxGeometry(3.45, skirtHeight, skirtThick);
    const skirtE = new THREE.Mesh(skirtEGeo, matSkirting);
    skirtE.rotation.y = Math.PI / 2;
    skirtE.position.set(getWorldX(10050) - wallT/2 - skirtThick/2, skirtHeight/2, getWorldZ(1725));
    scene.add(skirtE);
    detailObjects.push(skirtE);
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
    
    ROOMS_DATA.forEach(room => {
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
    const labels = document.querySelectorAll('.room-label, .dimension-label');
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
        tempV.project(camera);
        
        if (tempV.z > 1) {
            label.style.opacity = 0;
            return;
        }
        
        const screenX = (tempV.x * widthHalf) + widthHalf;
        const screenY = -(tempV.y * heightHalf) + heightHalf;
        
        label.style.opacity = 1;
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
        
        div.addEventListener('click', () => {
            addFurnitureToRoom(item.id);
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
                child.material.color.getHexString() === '63b3ed';
                
            if (!isSpecific) {
                child.material.color.copy(color);
            }
        }
    });
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
        document.getElementById('selected-width').value = selectedObject.userData.width;
        document.getElementById('selected-depth').value = selectedObject.userData.depth;
        document.getElementById('selected-height').value = selectedObject.userData.height;
        document.getElementById('selected-pos-y').value = Math.round(selectedObject.position.y * UNIT_TO_MM);
        
        const deg = Math.round(selectedObject.rotation.y * (180 / Math.PI));
        document.getElementById('selected-rotation').value = deg;
        document.getElementById('rotation-val').innerText = `${deg}°`;
        
        document.getElementById('selected-color').value = selectedObject.userData.color;
    } else {
        document.querySelector('.no-selection-msg').style.display = 'block';
        document.querySelector('.selection-controls').style.display = 'none';
    }
}

function addSelectionHelper(obj) {
    const boxHelper = new THREE.BoxHelper(obj, 0x6366f1);
    boxHelper.name = "selectionOutline";
    obj.add(boxHelper);
}

function removeSelectionHelper(obj) {
    const boxHelper = obj.getObjectByName("selectionOutline");
    if (boxHelper) {
        obj.remove(boxHelper);
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
    
    container.addEventListener('mousedown', onMouseDown, false);
    container.addEventListener('mousemove', onMouseMove, false);
    window.addEventListener('mouseup', onMouseUp, false);
    
    document.getElementById('btn-update-walls').addEventListener('click', () => {
        wallThickness = parseFloat(document.getElementById('wall-thickness').value) || 200;
        buildApartment();
        buildDimensionGuides();
    });
    
    // 뷰포트 제어
    document.getElementById('btn-view-3d').addEventListener('click', (e) => {
        is2DMode = false;
        document.getElementById('btn-view-2d').classList.remove('active');
        e.currentTarget.classList.add('active');
        controls.enableRotate = true;
        
        if (dimensionsGroup) dimensionsGroup.visible = false; 
        destroyDimensionLabelsDOM(); 
        buildRoomLabelsDOM(); 
        
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
    
    document.getElementById('btn-delete-selected').addEventListener('click', () => {
        if (!selectedObject) return;
        deleteFurniture(selectedObject);
    });
    
    document.getElementById('bg-photo-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            const overlay = document.getElementById('background-photo-overlay');
            overlay.style.backgroundImage = `url(${event.target.result})`;
            overlay.style.display = 'block';
            document.getElementById('bg-controls-group').style.display = 'block';
            renderer.setClearColor(0x000000, 0);
        };
        reader.readAsDataURL(file);
    });
    
    document.getElementById('bg-opacity').addEventListener('input', (e) => {
        const overlay = document.getElementById('background-photo-overlay');
        overlay.style.opacity = e.target.value / 100;
    });
    
    let bgVisible = true;
    document.getElementById('btn-bg-toggle').addEventListener('click', (e) => {
        const overlay = document.getElementById('background-photo-overlay');
        bgVisible = !bgVisible;
        if (bgVisible) {
            overlay.style.display = 'block';
            e.currentTarget.innerHTML = `<i class="fa-solid fa-eye-slash"></i> 숨기기`;
        } else {
            overlay.style.display = 'none';
            e.currentTarget.innerHTML = `<i class="fa-solid fa-eye"></i> 보이기`;
        }
    });
    
    document.getElementById('btn-bg-clear').addEventListener('click', () => {
        const overlay = document.getElementById('background-photo-overlay');
        overlay.style.backgroundImage = 'none';
        overlay.style.display = 'none';
        document.getElementById('bg-controls-group').style.display = 'none';
        document.getElementById('bg-photo-upload').value = '';
    });
    
    document.querySelectorAll('.preset-item[data-type="floor"]').forEach(item => {
        item.addEventListener('click', (e) => {
            document.querySelectorAll('.preset-item[data-type="floor"]').forEach(i => i.classList.remove('active'));
            e.currentTarget.classList.add('active');
            buildApartment();
            buildDimensionGuides();
        });
    });
    
    document.getElementById('floor-texture-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            textureLoader.load(event.target.result, (texture) => {
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                floorTextures['custom_floor'] = texture;
                buildApartment();
                buildDimensionGuides();
            });
        };
        reader.readAsDataURL(file);
    });

    document.querySelectorAll('.preset-item[data-type="wall"]').forEach(item => {
        item.addEventListener('click', (e) => {
            document.querySelectorAll('.preset-item[data-type="wall"]').forEach(i => i.classList.remove('active'));
            e.currentTarget.classList.add('active');
            wallTextures['custom'] = null;
            buildApartment();
            buildDimensionGuides();
        });
    });
    
    document.getElementById('wall-texture-upload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            textureLoader.load(event.target.result, (texture) => {
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                wallTextures['custom'] = texture;
                
                document.querySelectorAll('.preset-item[data-type="wall"]').forEach(i => i.classList.remove('active'));
                buildApartment();
                buildDimensionGuides();
            });
        };
        reader.readAsDataURL(file);
    });
    
    document.getElementById('btn-export-json').addEventListener('click', exportLayoutJSON);
    
    const importTrigger = document.getElementById('btn-import-trigger');
    const importInput = document.getElementById('input-import-json');
    importTrigger.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', importLayoutJSON);
}

function updateOutline() {
    if (!selectedObject) return;
    const boxHelper = selectedObject.getObjectByName("selectionOutline");
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
    if (event.target !== renderer.domElement) return;
    event.preventDefault();
    
    const coords = getCanvasMouseCoords(event);
    mouse.x = coords.x;
    mouse.y = coords.y;
    
    raycaster.setFromCamera(mouse, camera);
    
    // 방문 클릭 감지를 포함하여 scene 전체의 오브젝트 레이캐스팅
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        
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
        } else {
            selectObject(null);
        }
    } else {
        selectObject(null);
    }
}

function onMouseMove(event) {
    if (!isDragging || !selectedObject) return;
    
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

// --- 3D 렌더링 루프 ---
function animate() {
    requestAnimationFrame(animate);
    
    updateKeyboardMovement();
    
    if (controls) {
        controls.update();
    }
    
    updateRoomLabels();
    
    if (scene && camera && renderer) {
        renderer.render(scene, camera);
    }
}
