/**
 * 신규 가구/가전 배치 전용 모듈 (appliances_furniture.js)
 * 
 * [한국어 강제 원칙]
 * 본 파일은 기존 아파트 집 구조 및 빌트인 설비(변경 불가능)와 분리하여,
 * 사용자가 새로 구매하여 자유롭게 이동, 회전, 수정, 삭제하고자 하는
 * 신규 가구 및 가전제품의 데이터와 커스텀 3D 렌더링 로직을 독립적으로 관리합니다.
 */

// 1. 신규 구매 가구/가전 카탈로그 데이터 정의 (마우스 드래그 이동 및 수정 가능)
const NEW_CATALOG = [
    { 
        id: 'new_tv_wall', 
        name: '새로산 벽걸이 TV (75인치)', 
        category: 'appliances', 
        icon: 'fa-tv', 
        width: 1670.0, 
        depth: 27.7, 
        height: 957.4, 
        color: '#151515', 
        type: 'custom_wall_tv' 
    },
    { 
        id: 'fiture_desk_e2', 
        name: '핏쳐 모션데스크 E2', 
        category: 'living', 
        icon: 'fa-table', 
        width: 1200.0, 
        depth: 750.0, 
        height: 720.0, 
        color: 'all_white', 
        frameColor: '#f8fafc', 
        type: 'custom_motion_desk' 
    },
    {
        id: 'layout_hanger_800',
        name: '레이어 미드센츄리 2단 행거형 800',
        category: 'living',
        icon: 'fa-shirt',
        width: 800.0,
        depth: 400.0,
        height: 2000.0,
        color: '#ffffff',
        type: 'custom_modular_hanger_800'
    },
    {
        id: 'layout_hanger_600',
        name: '레이어 미드센츄리 긴 옷 행거형 600',
        category: 'living',
        icon: 'fa-shirt',
        width: 600.0,
        depth: 400.0,
        height: 2000.0,
        color: '#ffffff',
        type: 'custom_modular_hanger_600'
    },
    {
        id: 'samsung_combo_laundry',
        name: '삼성 비스포크 AI 콤보 + 수납함',
        category: 'appliances',
        icon: 'fa-soap',
        width: 686.0,
        depth: 786.0,
        height: 1491.0,
        color: '#374151',
        type: 'custom_samsung_combo'
    }
];

// 2. 신규 가구/가전 타입에 따른 커스텀 3D 메쉬 생성기
function createCustomFurnitureMesh(catalogItem) {
    if (!catalogItem || !catalogItem.type) return null;

    // 만약 custom_ 타입이 아니라면 null을 반환하여 기존 app_v2.js의 기본 생성기로 복귀시킵니다.
    if (!catalogItem.type.startsWith('custom_')) {
        return null;
    }

    const group = new THREE.Group();
    group.name = catalogItem.name;
    const w = catalogItem.width * 0.001; // mm -> unit
    const d = catalogItem.depth * 0.001; // mm -> unit
    const h = catalogItem.height * 0.001; // mm -> unit
    const color = new THREE.Color(catalogItem.color);

    // 가전 및 가구 타입별 커스텀 3D 모델링 스위치문
    switch (catalogItem.type) {
        case 'custom_wall_tv':
            // 75인치 슬림 TV 본체 (초슬림 27.7mm 구현)
            const bodyGeo = new THREE.BoxGeometry(w, h, d);
            const bodyMat = new THREE.MeshStandardMaterial({ 
                color: color, 
                roughness: 0.4, 
                metalness: 0.6 
            });
            const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
            bodyMesh.position.y = h / 2;
            group.add(bodyMesh);

            // 전면 LED 스크린 베젤 인셋을 고려한 패널 (베젤 좌우상하 6mm 두께)
            const screenW = w - 0.012;
            const screenH = h - 0.012;
            const screenD = 0.002;
            const screenGeo = new THREE.BoxGeometry(screenW, screenH, screenD);
            
            // 전면 스크린 텍스처 로딩 실패 또는 CORS 차단을 방어하기 위해 차콜 블랙 액정을 디폴트로 지정
            const screenMat = new THREE.MeshStandardMaterial({ 
                color: 0x111111, 
                roughness: 0.15, 
                metalness: 0.8 
            });
            
            if (typeof textureLoader !== 'undefined') {
                textureLoader.load(
                    'tv_mountain_wallpaper.png', 
                    // 로드 완료 시 콜백
                    (texture) => {
                        texture.encoding = THREE.sRGBEncoding;
                        screenMat.color.setHex(0xffffff); // 이미지가 완전히 입혀지도록 기본 필터 컬러를 백색으로 초기화
                        screenMat.map = texture;
                        screenMat.needsUpdate = true;
                    },
                    // 진행 상황 콜백
                    undefined,
                    // 로딩 실패 에러 콜백 (로컬 file:// 실행 시 CORS 차단 방어)
                    (err) => {
                        console.warn("TV 스크린 배경화면 이미지 로드 실패 (로컬 file:// 실행 시 CORS 차단 현상):", err);
                    }
                );
            }
            
            const screenMesh = new THREE.Mesh(screenGeo, screenMat);
            // 본체 전면(+Z)에 얇게 밀착 부착
            screenMesh.position.set(0, h / 2, d / 2 + 0.0005);
            group.add(screenMesh);

            // 벽걸이 브래킷 디테일 (벽면 묻힘 방지 및 실감나는 공중부양 4cm 틈새 입체화)
            const bracketGeo = new THREE.BoxGeometry(0.4, 0.3, 0.04); // 두께 4cm로 보강
            const bracketMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8, metalness: 0.9 });
            const bracketMesh = new THREE.Mesh(bracketGeo, bracketMat);
            // 본체 뒷면(-d/2)에서 브래킷 깊이 절반(0.02m)만큼 뒤로 배치
            bracketMesh.position.set(0, h / 2, -d / 2 - 0.02);
            group.add(bracketMesh);
            break;
            
        case 'custom_motion_desk':
            // 1. 책상 상판 (Desktop - 두께 25mm 고정 및 5가지 실사 사양 대응)
            const topThickness = 0.025;
            const topGeo = new THREE.BoxGeometry(w, topThickness, d);
            
            const topColorKey = catalogItem.color || 'all_white';
            let faceColorHex, edgeColorHex;
            
            // 5가지 제품 상세 색상 사양 파싱
            if (topColorKey === 'white_oak') {
                faceColorHex = '#ffffff';
                edgeColorHex = '#d6b89a';
            } else if (topColorKey === 'black_oak') {
                faceColorHex = '#1a1a1a';
                edgeColorHex = '#d6b89a';
            } else if (topColorKey === 'all_oak') {
                faceColorHex = '#d6b89a';
                edgeColorHex = '#d6b89a';
            } else if (topColorKey === 'all_white') {
                faceColorHex = '#ffffff';
                edgeColorHex = '#ffffff';
            } else if (topColorKey === 'all_black') {
                faceColorHex = '#1a1a1a';
                edgeColorHex = '#1a1a1a';
            } else {
                // 기존 단순 헥사코드 입력에 대한 예외 방어
                faceColorHex = catalogItem.color;
                edgeColorHex = catalogItem.color;
            }
            
            const faceMat = new THREE.MeshStandardMaterial({ 
                color: new THREE.Color(faceColorHex), 
                roughness: 0.6, 
                metalness: 0.1 
            });
            const edgeMat = new THREE.MeshStandardMaterial({ 
                color: new THREE.Color(edgeColorHex), 
                roughness: 0.6, 
                metalness: 0.1 
            });
            
            // BoxGeometry 면 인덱스 매핑: 0,1 (X옆면), 2,3 (Y윗/아랫면), 4,5 (Z옆면)
            const topMats = [
                edgeMat, // X+ 옆면
                edgeMat, // X- 옆면
                faceMat, // Y+ 윗면
                faceMat, // Y- 아랫면
                edgeMat, // Z+ 옆면
                edgeMat  // Z- 옆면
            ];
            
            const topMesh = new THREE.Mesh(topGeo, topMats);
            topMesh.position.y = h - topThickness / 2;
            group.add(topMesh);

            // 2. 하부 철제 지지대 프레임 (Underframe - 다리와 상판 고정용 빔)
            // 상판 길이보다 20cm 작게 설계 (최소 40cm 보장)
            const frameW = Math.max(w - 0.2, 0.4);
            const frameGeo = new THREE.BoxGeometry(frameW, 0.03, 0.05);
            const frameColorHex = catalogItem.frameColor || '#f8fafc';
            const frameColor = new THREE.Color(frameColorHex);
            const steelMat = new THREE.MeshStandardMaterial({ 
                color: frameColor, 
                roughness: 0.3, 
                metalness: 0.8 
            });
            const frameMesh = new THREE.Mesh(frameGeo, steelMat);
            frameMesh.position.set(0, h - topThickness - 0.015, 0);
            group.add(frameMesh);

            // 3. 듀얼 스퀘어 전동 기둥 다리 (Dual Columns)
            // 상판 양 끝에서 15cm 안쪽에 배치 (최소 간격 유지)
            const legOffset = Math.max(w / 2 - 0.15, 0.2);
            const footThickness = 0.03; // 발받침판 두께 3cm
            const legHeight = Math.max(h - topThickness - 0.03 - footThickness, 0.1);

            const columnGeo = new THREE.BoxGeometry(0.08, legHeight, 0.05); // 가로 8cm, 세로 5cm 사각 파이프 기둥
            
            // 왼쪽 사각 기둥 다리
            const leftCol = new THREE.Mesh(columnGeo, steelMat);
            leftCol.position.set(-legOffset, legHeight / 2 + footThickness, 0);
            group.add(leftCol);

            // 오른쪽 사각 기둥 다리
            const rightCol = new THREE.Mesh(columnGeo, steelMat);
            rightCol.position.set(legOffset, legHeight / 2 + footThickness, 0);
            group.add(rightCol);

            // 4. 바닥 접지 발 받침대 (Feet)
            // 가로 9cm, 두께 3cm, 깊이 68cm 스태빌라이저
            const footGeo = new THREE.BoxGeometry(0.09, footThickness, 0.68);
            
            // 왼쪽 발 받침
            const leftFoot = new THREE.Mesh(footGeo, steelMat);
            leftFoot.position.set(-legOffset, footThickness / 2, 0);
            group.add(leftFoot);

            // 오른쪽 발 받침
            const rightFoot = new THREE.Mesh(footGeo, steelMat);
            rightFoot.position.set(legOffset, footThickness / 2, 0);
            group.add(rightFoot);
            break;
            
        case 'custom_modular_hanger_800': {
            // [퓨어화이트 2단 서랍 행거형 800]
            const pipeRad = 0.008; // 파이프 반경 8mm
            const steelMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.15, metalness: 0.9 });
            const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
            
            // 1. 수직 기둥 4개 조립 (H=2.0m)
            const legGeo = new THREE.CylinderGeometry(pipeRad, pipeRad, h, 8);
            const positions = [
                [-w/2 + pipeRad, h/2, -d/2 + pipeRad],
                [ w/2 - pipeRad, h/2, -d/2 + pipeRad],
                [-w/2 + pipeRad, h/2,  d/2 - pipeRad],
                [ w/2 - pipeRad, h/2,  d/2 - pipeRad]
            ];
            positions.forEach(pos => {
                const leg = new THREE.Mesh(legGeo, steelMat);
                leg.position.set(pos[0], pos[1], pos[2]);
                group.add(leg);
            });
            
            // 2. 가로 프레임 보강대 (천장, 선반 지지대 등)
            const addHBar = (posY, len, isX) => {
                const barGeo = new THREE.CylinderGeometry(pipeRad, pipeRad, len, 8);
                const bar = new THREE.Mesh(barGeo, steelMat);
                bar.position.y = posY;
                if (isX) {
                    bar.rotation.z = Math.PI / 2;
                } else {
                    bar.rotation.x = Math.PI / 2;
                }
                return bar;
            };
            
            // 천장 테두리 보강대 4개
            const capX1 = addHBar(h - pipeRad, w - pipeRad * 2, true); capX1.position.z = -d/2 + pipeRad; group.add(capX1);
            const capX2 = addHBar(h - pipeRad, w - pipeRad * 2, true); capX2.position.z =  d/2 - pipeRad; group.add(capX2);
            const capZ1 = addHBar(h - pipeRad, d - pipeRad * 2, false); capZ1.position.x = -w/2 + pipeRad; group.add(capZ1);
            const capZ2 = addHBar(h - pipeRad, d - pipeRad * 2, false); capZ2.position.x =  w/2 - pipeRad; group.add(capZ2);
            
            // 바닥 보강대 4개
            const botX1 = addHBar(0.05, w - pipeRad * 2, true); botX1.position.z = -d/2 + pipeRad; group.add(botX1);
            const botX2 = addHBar(0.05, w - pipeRad * 2, true); botX2.position.z =  d/2 - pipeRad; group.add(botX2);
            const botZ1 = addHBar(0.05, d - pipeRad * 2, false); botZ1.position.x = -w/2 + pipeRad; group.add(botZ1);
            const botZ2 = addHBar(0.05, d - pipeRad * 2, false); botZ2.position.x =  w/2 - pipeRad; group.add(botZ2);
            
            // 3. 하단 2단 서랍장 박스 (높이 8cm ~ 70cm 구간)
            const boxH = 0.62; // 서랍장 박스 높이 62cm
            const boxW = w - pipeRad * 2;
            const boxD = d - pipeRad * 2;
            const boxGeo = new THREE.BoxGeometry(boxW, boxH, boxD);
            const boxMesh = new THREE.Mesh(boxGeo, whiteMat);
            boxMesh.position.set(0, 0.08 + boxH / 2, 0);
            group.add(boxMesh);
            
            // 서랍 2단 앞판 분리선 연출 및 앞판(Drawers) 결합
            const drawerW = boxW - 0.01;
            const drawerH = boxH / 2 - 0.01;
            const drawerGeo = new THREE.BoxGeometry(drawerW, drawerH, 0.005);
            
            // 1단 서랍 (아래)
            const d1 = new THREE.Mesh(drawerGeo, whiteMat);
            d1.position.set(0, 0.08 + drawerH/2 + 0.005, boxD/2 + 0.002);
            group.add(d1);
            
            // 2단 서랍 (위)
            const d2 = new THREE.Mesh(drawerGeo, whiteMat);
            d2.position.set(0, 0.08 + boxH - drawerH/2 - 0.005, boxD/2 + 0.002);
            group.add(d2);
            
            // 단추형 은색 손잡이 노브 2개 부착
            const knobGeo = new THREE.SphereGeometry(0.01, 16, 16);
            const knob1 = new THREE.Mesh(knobGeo, steelMat);
            knob1.position.set(0, 0.08 + drawerH/2 + 0.005, boxD/2 + 0.012);
            group.add(knob1);
            
            const knob2 = new THREE.Mesh(knobGeo, steelMat);
            knob2.position.set(0, 0.08 + boxH - drawerH/2 - 0.005, boxD/2 + 0.012);
            group.add(knob2);
            
            // 4. 상단 옷걸이 봉 (H=1.9m)
            const rodGeo = new THREE.CylinderGeometry(0.008, 0.008, w - pipeRad * 4, 8);
            const rod = new THREE.Mesh(rodGeo, steelMat);
            rod.position.set(0, h - 0.1, 0);
            rod.rotation.z = Math.PI / 2;
            group.add(rod);
            
            break;
        }
        
        case 'custom_modular_hanger_600': {
            // [퓨어화이트 긴 옷 행거형 600]
            const pipeRad = 0.008; // 파이프 반경 8mm
            const steelMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.15, metalness: 0.9 });
            const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
            
            // 1. 수직 기둥 4개 조립 (H=2.0m)
            const legGeo = new THREE.CylinderGeometry(pipeRad, pipeRad, h, 8);
            const positions = [
                [-w/2 + pipeRad, h/2, -d/2 + pipeRad],
                [ w/2 - pipeRad, h/2, -d/2 + pipeRad],
                [-w/2 + pipeRad, h/2,  d/2 - pipeRad],
                [ w/2 - pipeRad, h/2,  d/2 - pipeRad]
            ];
            positions.forEach(pos => {
                const leg = new THREE.Mesh(legGeo, steelMat);
                leg.position.set(pos[0], pos[1], pos[2]);
                group.add(leg);
            });
            
            // 2. 가로 프레임 보강대
            const addHBar = (posY, len, isX) => {
                const barGeo = new THREE.CylinderGeometry(pipeRad, pipeRad, len, 8);
                const bar = new THREE.Mesh(barGeo, steelMat);
                bar.position.y = posY;
                if (isX) {
                    bar.rotation.z = Math.PI / 2;
                } else {
                    bar.rotation.x = Math.PI / 2;
                }
                return bar;
            };
            
            // 천장 테두리 보강대 4개
            const capX1 = addHBar(h - pipeRad, w - pipeRad * 2, true); capX1.position.z = -d/2 + pipeRad; group.add(capX1);
            const capX2 = addHBar(h - pipeRad, w - pipeRad * 2, true); capX2.position.z =  d/2 - pipeRad; group.add(capX2);
            const capZ1 = addHBar(h - pipeRad, d - pipeRad * 2, false); capZ1.position.x = -w/2 + pipeRad; group.add(capZ1);
            const capZ2 = addHBar(h - pipeRad, d - pipeRad * 2, false); capZ2.position.x =  w/2 - pipeRad; group.add(capZ2);
            
            // 바닥 보강대 4개
            const botX1 = addHBar(0.05, w - pipeRad * 2, true); botX1.position.z = -d/2 + pipeRad; group.add(botX1);
            const botX2 = addHBar(0.05, w - pipeRad * 2, true); botX2.position.z =  d/2 - pipeRad; group.add(botX2);
            const botZ1 = addHBar(0.05, d - pipeRad * 2, false); botZ1.position.x = -w/2 + pipeRad; group.add(botZ1);
            const botZ2 = addHBar(0.05, d - pipeRad * 2, false); botZ2.position.x =  w/2 - pipeRad; group.add(botZ2);
            
            // 3. 선반 판재 3단 배치 (높이 8cm, 38cm, 68cm)
            const shelfThick = 0.015; // 선반 두께 15mm
            const shelfW = w - pipeRad * 2;
            const shelfD = d - pipeRad * 2;
            const shelfGeo = new THREE.BoxGeometry(shelfW, shelfThick, shelfD);
            
            const shelfHeights = [0.08, 0.38, 0.68];
            shelfHeights.forEach(sh => {
                const shelf = new THREE.Mesh(shelfGeo, whiteMat);
                shelf.position.set(0, sh + shelfThick/2, 0);
                group.add(shelf);
                
                // 각 선반 하단 가로 프레임 빔 보강
                const bX1 = addHBar(sh, w - pipeRad * 2, true); bX1.position.z = -d/2 + pipeRad; group.add(bX1);
                const bX2 = addHBar(sh, w - pipeRad * 2, true); bX2.position.z =  d/2 - pipeRad; group.add(bX2);
            });
            
            // 4. 상단 옷걸이 봉 (H=1.9m)
            const rodGeo = new THREE.CylinderGeometry(0.008, 0.008, w - pipeRad * 4, 8);
            const rod = new THREE.Mesh(rodGeo, steelMat);
            rod.position.set(0, h - 0.1, 0);
            rod.rotation.z = Math.PI / 2;
            group.add(rod);
            
            break;
        }
        
        case 'custom_samsung_combo': {
            // [삼성 비스포크 AI 콤보 + 하단 수납함]
            const mainColor = 0x27292d; // 비스포크 다크 그레이 메탈 컬러
            const glassColor = 0x0f172a; // 드럼 투명 블랙 유리 컬러
            const screenColor = 0x0284c7; // LCD 디스플레이 하늘색 컬러
            const chromeColor = 0xc8cbd0; // 크롬 실버 데코 링 컬러
            
            const metalMat = new THREE.MeshStandardMaterial({ color: mainColor, roughness: 0.35, metalness: 0.75 });
            const chromeMat = new THREE.MeshStandardMaterial({ color: chromeColor, roughness: 0.15, metalness: 0.9 });
            const glassMat = new THREE.MeshStandardMaterial({ color: glassColor, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.8 });
            const screenMat = new THREE.MeshStandardMaterial({ color: screenColor, roughness: 0.1, metalness: 0.8, emissive: 0x0ea5e9, emissiveIntensity: 0.4 });
            const darkMat = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.5, metalness: 0.2 });
            
            // 1. 하단 수납함 (H = 38.1cm)
            const hSub = 0.381;
            const subGeo = new THREE.BoxGeometry(w, hSub, d);
            const subMesh = new THREE.Mesh(subGeo, metalMat);
            subMesh.position.set(0, hSub / 2, 0);
            group.add(subMesh);
            
            // 수납함 서랍 앞판 및 하부 틈새 선
            const subDrawerGeo = new THREE.BoxGeometry(w - 0.01, hSub - 0.03, 0.005);
            const subDrawer = new THREE.Mesh(subDrawerGeo, metalMat);
            subDrawer.position.set(0, hSub / 2 + 0.005, d/2 + 0.002);
            group.add(subDrawer);
            
            // 2. 세탁기 본체 (H = 1.11m)
            const hCombo = h - hSub;
            const bodyGeo = new THREE.BoxGeometry(w, hCombo, d);
            const bodyMesh = new THREE.Mesh(bodyGeo, metalMat);
            bodyMesh.position.set(0, hSub + hCombo / 2, 0);
            group.add(bodyMesh);
            
            // 3. 전면 드럼 도어 (유리창)
            const doorY = hSub + hCombo * 0.45; // 도어 높이 위치
            const doorZ = d/2 + 0.005;
            
            // 외곽 실버 크롬 데코 링
            const ringGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.015, 32);
            const ring = new THREE.Mesh(ringGeo, chromeMat);
            ring.position.set(0, doorY, doorZ);
            ring.rotation.x = Math.PI / 2;
            group.add(ring);
            
            // 안쪽 투명 블랙 글라스 드럼 창
            const drumGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.018, 32);
            const drum = new THREE.Mesh(drumGeo, glassMat);
            drum.position.set(0, doorY, doorZ + 0.002);
            drum.rotation.x = Math.PI / 2;
            group.add(drum);
            
            // 4. 상단 터치 조작 콘솔 패널
            const consoleH = 0.14;
            const consoleY = h - consoleH / 2 - 0.02;
            const consoleZ = d/2 + 0.004;
            
            const consoleGeo = new THREE.BoxGeometry(w - 0.02, consoleH, 0.008);
            const consoleMesh = new THREE.Mesh(consoleGeo, darkMat);
            consoleMesh.position.set(0, consoleY, consoleZ);
            group.add(consoleMesh);
            
            // 5. 177.8mm 터치 LCD 디스플레이 화면
            const lcdW = 0.22;
            const lcdH = 0.06;
            const lcd = new THREE.Mesh(new THREE.BoxGeometry(lcdW, lcdH, 0.01), screenMat);
            lcd.position.set(0, consoleY, consoleZ + 0.005);
            group.add(lcd);
            
            break;
        }

        default:
            // 기본 박스 렌더링
            const defaultGeo = new THREE.BoxGeometry(w, h, d);
            const defaultMat = new THREE.MeshStandardMaterial({ 
                color: color, 
                roughness: 0.5, 
                metalness: 0.1 
            });
            const defaultMesh = new THREE.Mesh(defaultGeo, defaultMat);
            defaultMesh.position.y = h / 2;
            group.add(defaultMesh);
            break;
    }

    return group;
}
