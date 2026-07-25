// ============================================================
// 오늘의 QT — Firebase 초기화 + 익명 로그인 자동 실행 + 구글 로그인
// ------------------------------------------------------------
// 이 파일을 index.html에서
// <script type="module" src="firebase-init.js"></script>
// 로 불러오면, 앱이 켜질 때 자동으로 Firebase에 연결되고
// 화면 없이 "익명 로그인"이 자동으로 실행됩니다.
//
// 추가: 구글 로그인 버튼을 누르면 window.signInWithGoogle() 이 실행되며,
// 기존 익명 계정에 구글 계정을 "연결"해서 UID와 데이터를 그대로 유지합니다.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  linkWithPopup,
  signInWithCredential,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// 콘솔에서 받은 본인의 firebaseConfig 값 (todaysqt 프로젝트)
const firebaseConfig = {
  apiKey: "AIzaSyB5oRUK_beEH61lumqbgljeKlTQ8cM4wnM",
  authDomain: "todaysqt-6b0c8.firebaseapp.com",
  projectId: "todaysqt-6b0c8",
  storageBucket: "todaysqt-6b0c8.firebasestorage.app",
  messagingSenderId: "893754342999",
  appId: "1:893754342999:web:a9e35273295e5ca9e4ed12",
};

// Firebase 앱 초기화
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 다른 화면(JS)에서도 쓸 수 있도록 전역에 보관
window.qtAuth = auth;
window.qtDb = db;

// user 객체 -> 항상 최신 상태를 반영하는 프로필 정보로 변환
// (providerData를 우선으로 보고, top-level 값을 백업으로 사용)
function computeEffectiveProfile(user) {
  if (!user) {
    return { isAnonymous: true, displayName: null, photoURL: null, email: null };
  }
  const provider = (user.providerData && user.providerData[0]) || null;
  return {
    isAnonymous: !(user.providerData && user.providerData.length > 0),
    displayName: (provider && provider.displayName) || user.displayName || null,
    photoURL: (provider && provider.photoURL) || user.photoURL || null,
    email: (provider && provider.email) || user.email || null,
  };
}

// meditation.js 등 다른 스크립트에서 "지금 이 순간"의 로그인 정보를
// 캐시 없이 직접 다시 계산해서 가져갈 수 있도록 함수로 노출
window.qtGetProfile = function () {
  return computeEffectiveProfile(auth.currentUser);
};

// 로그인 상태를 계속 감시
onAuthStateChanged(auth, (user) => {
  if (user) {
    // 이미 로그인됨 (익명 또는 구글 연동 후 계정)
    window.qtUser = user;

    const effective = computeEffectiveProfile(user);

    // meditation.js 등 다른 스크립트에서 재사용할 수 있도록 전역 보관
    window.qtProfile = effective;

    console.log(
      "[오늘의QT] 로그인 완료 · UID:",
      user.uid,
      "· 익명 여부:",
      effective.isAnonymous,
      "· 이름:",
      effective.displayName || "(없음)"
    );

    // 다른 스크립트에서 로그인 완료 시점을 알 수 있도록 이벤트 발생
    document.dispatchEvent(
      new CustomEvent("qt-auth-ready", {
        detail: {
          uid: user.uid,
          isAnonymous: effective.isAnonymous,
          displayName: effective.displayName,
          photoURL: effective.photoURL,
          email: effective.email,
          creationTime: user.metadata ? user.metadata.creationTime : null,
        },
      })
    );
  } else {
    // 아직 로그인 안 됨 -> 화면 없이 익명 로그인 자동 시도
    signInAnonymously(auth).catch((err) => {
      console.error("[오늘의QT] 익명 로그인 실패:", err.code, err.message);
    });
  }
});

// ------------------------------------------------------------
// 구글 로그인 (버튼에서 호출)
// ------------------------------------------------------------
// 현재 익명 계정이 있으면 -> 구글 계정을 "연결"해서 UID/데이터 유지
// 익명 계정이 없으면 -> 그냥 구글로 새 로그인
window.signInWithGoogle = async function () {
  const provider = new GoogleAuthProvider();

  try {
    if (auth.currentUser && auth.currentUser.isAnonymous) {
      // 익명 계정 -> 구글 계정으로 업그레이드 (UID 그대로 유지)
      const result = await linkWithPopup(auth.currentUser, provider);
      console.log("[오늘의QT] 익명 계정을 구글 계정으로 연결 완료:", result.user.uid);
    } else {
      // 익명 계정이 없는 상태 -> 그냥 구글 로그인
      const result = await signInWithPopup(auth, provider);
      console.log("[오늘의QT] 구글 로그인 완료:", result.user.uid);
    }
  } catch (err) {
    if (err.code === "auth/credential-already-in-use") {
      // 이 구글 계정이 예전에 다른 기기/세션에서 이미 가입된 적 있는 경우
      // -> 그 기존 계정으로 그냥 로그인 (이번 기기의 익명 데이터는 연결되지 않음)
      console.warn("[오늘의QT] 이미 가입된 구글 계정 -> 기존 계정으로 로그인");
      const credential = GoogleAuthProvider.credentialFromError(err);
      try {
        const result = await signInWithCredential(auth, credential);
        console.log("[오늘의QT] 기존 구글 계정으로 로그인 완료:", result.user.uid);
      } catch (innerErr) {
        console.error("[오늘의QT] 구글 로그인 실패:", innerErr.code, innerErr.message);
      }
    } else if (err.code === "auth/popup-closed-by-user") {
      console.log("[오늘의QT] 사용자가 로그인 창을 닫음");
    } else {
      console.error("[오늘의QT] 구글 로그인 실패:", err.code, err.message);
    }
  }
};

// ------------------------------------------------------------
// 로그아웃 (마이페이지 로그아웃 버튼 / 타이틀바 프로필 사진 클릭 시 호출)
// ------------------------------------------------------------
// 로그아웃하면 onAuthStateChanged가 user=null로 다시 호출되고,
// 기존 코드가 자동으로 새 익명 계정을 만들어서 화면은 "익명 사용자" 상태로 돌아감
window.qtSignOut = async function () {
  try {
    await signOut(auth);
    console.log("[오늘의QT] 로그아웃 완료");
    return true;
  } catch (err) {
    console.error("[오늘의QT] 로그아웃 실패:", err.code, err.message);
    return false;
  }
};
