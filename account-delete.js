// ============================================================
// 오늘의 QT — 계정 삭제 (앱 '계정 삭제' 버튼 + delete-account.html 공용)
// ------------------------------------------------------------
// 삭제 순서: (1) 최근 로그인 확인/재인증 → (2) 내 데이터 삭제 → (3) 로그인 계정 삭제
// Firestore 데이터를 먼저 지워야 합니다. 계정을 먼저 지우면 권한이 사라져서
// 본인 데이터를 지울 수 없기 때문입니다.
// ============================================================

import {
  collection,
  collectionGroup,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  arrayRemove,
  increment,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  deleteUser,
  reauthenticateWithPopup,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

// 일부 항목이 실패해도 나머지는 계속 진행하고, 실패한 항목은 warnings 로 돌려줍니다.
async function step(warnings, label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error("[오늘의QT] 계정 삭제 중 실패 -", label, ":", err.code, err.message);
    warnings.push(label + " (" + (err.code || err.message) + ")");
  }
}

export async function deleteMyAccount(auth, db, onProgress) {
  var user = auth.currentUser;
  if (!user) throw new Error("로그인 상태가 아니에요.");
  var uid = user.uid;
  var warnings = [];
  var say = function (m) { if (onProgress) onProgress(m); };

  // (1) 오래전에 로그인한 계정이면 Google 로그인 창으로 다시 확인 (Firebase 보안 요구사항)
  var isAnonymous = !(user.providerData && user.providerData.length > 0);
  var lastSignIn = user.metadata && user.metadata.lastSignInTime ? Date.parse(user.metadata.lastSignInTime) : 0;
  if (!isAnonymous && Date.now() - lastSignIn > 5 * 60 * 1000) {
    say("본인 확인을 위해 Google 로그인을 한 번 더 진행해 주세요.");
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
  }

  // (2-a) 내가 쓴 묵상 + 그 묵상에 달린 댓글
  say("내가 쓴 묵상을 삭제하는 중...");
  await step(warnings, "내 묵상 삭제", async function () {
    var snap = await getDocs(query(collection(db, "meditations"), where("uid", "==", uid)));
    for (var i = 0; i < snap.docs.length; i++) {
      var d = snap.docs[i];
      try {
        var cs = await getDocs(collection(db, "meditations", d.id, "comments"));
        for (var j = 0; j < cs.docs.length; j++) await deleteDoc(cs.docs[j].ref);
      } catch (e) {
        warnings.push("묵상에 달린 댓글 삭제 (" + (e.code || e.message) + ")");
      }
      await deleteDoc(d.ref);
    }
  });

  // (2-b) 내가 다른 사람 묵상에 남긴 댓글
  say("내가 남긴 댓글을 삭제하는 중...");
  await step(warnings, "내 댓글 삭제", async function () {
    var snap = await getDocs(query(collectionGroup(db, "comments"), where("uid", "==", uid)));
    for (var i = 0; i < snap.docs.length; i++) {
      var ref = snap.docs[i].ref;
      var parent = ref.parent && ref.parent.parent;
      await deleteDoc(ref);
      if (parent) {
        try { await updateDoc(parent, { commentCount: increment(-1) }); } catch (e) { /* 부모 글이 이미 없으면 무시 */ }
      }
    }
  });

  // (2-c) 내가 누른 좋아요 취소
  say("좋아요 기록을 정리하는 중...");
  await step(warnings, "좋아요 정리", async function () {
    var snap = await getDocs(query(collection(db, "meditations"), where("likedBy", "array-contains", uid), where("privacy", "in", ["group", "church", "public"])));
    for (var i = 0; i < snap.docs.length; i++) {
      await updateDoc(snap.docs[i].ref, { likedBy: arrayRemove(uid), likeCount: increment(-1) });
    }
  });

  // (2-d) 알림 (받은 알림 + 내가 보낸 알림)
  say("알림 기록을 삭제하는 중...");
  await step(warnings, "받은 알림 삭제", async function () {
    var snap = await getDocs(query(collection(db, "notifications"), where("uid", "==", uid)));
    for (var i = 0; i < snap.docs.length; i++) await deleteDoc(snap.docs[i].ref);
  });
  await step(warnings, "보낸 알림 삭제", async function () {
    var snap = await getDocs(query(collection(db, "notifications"), where("fromUid", "==", uid)));
    for (var i = 0; i < snap.docs.length; i++) await deleteDoc(snap.docs[i].ref);
  });

  // (2-e) 교회/소그룹 소속 등 프로필 문서
  say("프로필 정보를 삭제하는 중...");
  await step(warnings, "프로필(소속) 삭제", async function () {
    await deleteDoc(doc(db, "users", uid));
  });

  // (3) 로그인 계정 자체 삭제
  say("계정을 삭제하는 중...");
  await deleteUser(user);

  return { warnings: warnings };
}
