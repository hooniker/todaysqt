// ============================================================
// 오늘의 QT — 묵상 저장 + 통계(연속 묵상 / 이번 달 / 총 묵상) 자동계산
// ------------------------------------------------------------
// firebase-init.js 이후에 로드되어야 합니다.
// window.qtDb, window.qtUser (firebase-init.js에서 설정) 를 사용합니다.
// ============================================================

import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  serverTimestamp,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  increment,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// 날짜 -> "YYYY-MM-DD" 문자열 (연속 묵상/이번 달 계산용 키)
function dateKeyOf(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, "0");
  var d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

// 묵상한 날짜 목록(dateKey 배열) -> 통계 계산
function computeStats(dateKeys) {
  var uniqueSet = new Set(dateKeys);
  var total = uniqueSet.size;

  var now = new Date();
  var thisMonthPrefix =
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  var thisMonth = 0;
  uniqueSet.forEach(function (k) {
    if (k.indexOf(thisMonthPrefix) === 0) thisMonth++;
  });

  // 연속 묵상: 오늘(또는 오늘 기록이 아직 없으면 어제)부터 거꾸로
  // 하루씩 비어있지 않은 날짜가 몇 일 연속인지 셉니다.
  var streak = 0;
  var cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!uniqueSet.has(dateKeyOf(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (uniqueSet.has(dateKeyOf(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { total: total, thisMonth: thisMonth, streak: streak };
}

function setText(id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ------------------------------------------------------------
// 묵상 글 저장 (btn-med-save 클릭 시 index.html에서 호출)
// ------------------------------------------------------------
window.saveMeditation = async function () {
  var db = window.qtDb;
  var user = window.qtUser;
  if (!db || !user) {
    throw new Error("아직 로그인 처리 중이에요. 잠시 후 다시 시도해주세요.");
  }

  var textEl = document.getElementById("med-text");
  var text = textEl ? textEl.value.trim() : "";
  if (!text) {
    throw new Error("묵상 내용을 입력해주세요.");
  }

  // 감사일기 (입력된 것만 모음)
  var thanks = [];
  document.querySelectorAll(".med-thanks-input").forEach(function (el) {
    if (el.value.trim()) thanks.push(el.value.trim());
  });

  // 기도제목
  var prayerEl = document.getElementById("med-prayer");
  var prayer = prayerEl ? prayerEl.value.trim() : "";

  // 공개 범위 (선택된 버튼의 data-val)
  var privacyBtn = document.querySelector(".med-privacy-btn.on");
  var privacy = privacyBtn ? privacyBtn.getAttribute("data-val") : "group";

  // 오늘의 말씀 출처 (묵상 화면 상단에 표시된 텍스트 그대로)
  var verseRefEl = document.querySelector(".med-verse-ref");
  var verseRef = verseRefEl ? verseRefEl.textContent.trim() : "";

  // 저장하는 바로 이 순간의 로그인 정보를 캐시 없이 직접 다시 확인
  // (로그인 직후 화면 갱신 타이밍이 어긋나서 "이름 없는 친구"로 잘못 저장되는 문제 방지)
  var profile = window.qtGetProfile ? window.qtGetProfile() : window.qtProfile;

  var now = new Date();

  await addDoc(collection(db, "meditations"), {
    uid: user.uid,
    authorName: (profile && profile.displayName) || "이름 없는 친구",
    authorPhoto: (profile && profile.photoURL) || "",
    text: text,
    thanks: thanks,
    prayer: prayer,
    privacy: privacy,
    churchName: (window.qtChurchProfile && window.qtChurchProfile.churchName) || "",
    groupName: (window.qtChurchProfile && window.qtChurchProfile.groupName) || "",
    verseRef: verseRef,
    dateKey: dateKeyOf(now),
    likedBy: [],
    likeCount: 0,
    createdAt: serverTimestamp(),
  });

  console.log("[오늘의QT] 묵상 저장 완료");

  // 저장 직후 통계 + 피드 + 리포트 캘린더 갱신
  await refreshStats();
  await window.loadGroupFeed();
  qtMyMeditationsCache = null; // 방금 쓴 글이 반영되도록 캐시 무효화
  qtMyMeditationsList = null;
  if (window.renderReportCalendar) window.renderReportCalendar();

  // 저장한 공개범위에 맞는 탭으로 자동 전환
  var privacyToTab = { group: 0, private: 1, church: 2, public: 3 };
  var tabIdx = privacyToTab[privacy] !== undefined ? privacyToTab[privacy] : 0;
  if (window.goTab) window.goTab(tabIdx);
};

// ------------------------------------------------------------
// 통계 불러와서 홈/마이페이지 숫자 갱신
// ------------------------------------------------------------
async function refreshStats() {
  var db = window.qtDb;
  var user = window.qtUser;
  if (!db || !user) return;

  try {
    var q = query(collection(db, "meditations"), where("uid", "==", user.uid));
    var snap = await getDocs(q);
    var dateKeys = [];
    snap.forEach(function (docSnap) {
      var d = docSnap.data();
      if (d.dateKey) dateKeys.push(d.dateKey);
    });

    var stats = computeStats(dateKeys);

    setText("home-streak", stats.streak);
    setText("home-month", stats.thisMonth);
    setText("my-streak", stats.streak);
    setText("my-month", stats.thisMonth);
    setText("my-total", stats.total);

    console.log("[오늘의QT] 통계 갱신:", stats);
  } catch (err) {
    console.error("[오늘의QT] 통계 불러오기 실패:", err.code, err.message);
  }
}
window.refreshStats = refreshStats;

// 로그인(익명 포함) 완료될 때마다 통계 자동 갱신
document.addEventListener("qt-auth-ready", async function () {
  refreshStats();
  await loadMyChurchProfile(); // 피드 필터링에 쓰이므로 피드 로드보다 먼저 끝내둠
  if (window.loadGroupFeed) window.loadGroupFeed();
  qtMyMeditationsCache = null; // 계정이 바뀌었을 수 있으니 캐시 초기화
  qtMyMeditationsList = null;
  if (window.renderReportCalendar) window.renderReportCalendar();
  if (window.loadNotifications) window.loadNotifications();
});

// ============================================================
// 소그룹 나눔 피드 (홈 화면 미리보기 + 나눔 페이지 전체)
// ============================================================

var avatarColors = [
  { bg: "#FDECD8", color: "#9A4E1A" },
  { bg: "#D8EDE3", color: "#1A5C3A" },
  { bg: "#E3DCF5", color: "#4B2E83" },
  { bg: "#FDE2E2", color: "#9A1A2E" },
  { bg: "#DCEAFB", color: "#1A4B8C" },
];

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function relativeTimeFrom(date) {
  var diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return diffMin + "분 전";
  var diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return diffHour + "시간 전";
  return Math.floor(diffHour / 24) + "일 전";
}

function avatarHtml(name, photoUrl, uid, sizeClass) {
  if (photoUrl) {
    return '<img class="' + sizeClass + '" src="' + photoUrl + '" style="object-fit:cover;">';
  }
  var idx = 0;
  for (var i = 0; i < (uid || "").length; i++) idx += uid.charCodeAt(i);
  var c = avatarColors[idx % avatarColors.length];
  var initials = (name || "QT").slice(0, 2);
  return (
    '<div class="' + sizeClass + '" style="background:' + c.bg + ';color:' + c.color + ';">' +
    escapeHtml(initials) +
    "</div>"
  );
}

// ============================================================
// 교회 / 소그룹 프로필
// ------------------------------------------------------------
// users/{uid} 문서에 본인이 속한 교회 이름 / 소그룹 이름을 저장.
// 묵상을 저장할 때 이 값을 그대로 복사해서 meditations 문서에도 같이
// 저장해두기 때문에(비정규화), 피드를 필터링할 때 다른 사용자 문서를
// 추가로 조회하지 않고도 "같은 교회/소그룹" 여부를 바로 비교할 수 있음.
// ============================================================
window.qtChurchProfile = null; // { churchName, groupName }

async function loadMyChurchProfile() {
  var db = window.qtDb;
  var user = window.qtUser;
  if (!db || !user) return null;

  try {
    var snap = await getDoc(doc(db, "users", user.uid));
    window.qtChurchProfile = snap.exists() ? snap.data() : { churchName: "", groupName: "" };
  } catch (err) {
    console.error("[오늘의QT] 교회/소그룹 정보 불러오기 실패:", err.code, err.message);
    window.qtChurchProfile = { churchName: "", groupName: "" };
  }

  if (window.renderChurchProfileUI) window.renderChurchProfileUI();
  return window.qtChurchProfile;
}
window.loadMyChurchProfile = loadMyChurchProfile;

window.saveMyChurchProfile = async function (churchName, groupName, defaultPrivacy) {
  var db = window.qtDb;
  var user = window.qtUser;
  if (!db || !user) return false;

  var cleanChurch = churchName.trim();
  var cleanGroup = groupName.trim();
  var cleanDefaultPrivacy = defaultPrivacy || "group";

  try {
    await setDoc(
      doc(db, "users", user.uid),
      { churchName: cleanChurch, groupName: cleanGroup, defaultPrivacy: cleanDefaultPrivacy, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.error("[오늘의QT] 교회/소그룹 저장 실패:", err.code, err.message);
    return false;
  }

  window.qtChurchProfile = { churchName: cleanChurch, groupName: cleanGroup, defaultPrivacy: cleanDefaultPrivacy };
  if (window.renderChurchProfileUI) window.renderChurchProfileUI();
  // 소속이 바뀌면 필터 결과도 달라지므로 피드 다시 로드
  if (window.loadGroupFeed) window.loadGroupFeed();
  return true;
};

// Firestore에서 공개범위 "소그룹" 글만 가져와서 최신순으로 정렬
window.loadGroupFeed = async function () {
  var db = window.qtDb;
  if (!db) return;

  try {
    var q = query(collection(db, "meditations"), where("privacy", "in", ["group", "church", "public"]));
    var snap = await getDocs(q);
    var posts = [];
    snap.forEach(function (docSnap) {
      var d = docSnap.data();
      d.id = docSnap.id;
      posts.push(d);
    });
    posts.sort(function (a, b) {
      var at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      var bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return bt - at;
    });

    window.qtGroupFeedCache = posts;

    // 나만보기(private) 글도 따로 캐시 (본인만 볼 수 있어야 하므로 별도 쿼리)
    var myUid = window.qtUser ? window.qtUser.uid : null;
    if (myUid) {
      var qPrivate = query(
        collection(db, "meditations"),
        where("privacy", "==", "private"),
        where("uid", "==", myUid)
      );
      var snapPrivate = await getDocs(qPrivate);
      var privatePosts = [];
      snapPrivate.forEach(function (docSnap) {
        var d = docSnap.data();
        d.id = docSnap.id;
        privatePosts.push(d);
      });
      privatePosts.sort(function (a, b) {
        var at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        var bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return bt - at;
      });
      window.qtPrivateFeedCache = privatePosts;
    }

    // 현재 선택된 탭 기준으로 렌더링
    window.applyFeedFilter(window.currentFeedTab || 0);

  } catch (err) {
    console.error("[오늘의QT] 소그룹 피드 불러오기 실패:", err.code, err.message);
  }
};

// 탭 필터 적용 (홈 미리보기 + 나눔 전체 피드)
window.applyFeedFilter = function (idx) {
  var filters = ["group", "private", "church", "public"];
  var filter = filters[idx] || "group";
  var allPosts = window.qtGroupFeedCache || [];

  var myChurch = (window.qtChurchProfile && window.qtChurchProfile.churchName) || "";
  var myGroupName = (window.qtChurchProfile && window.qtChurchProfile.groupName) || "";

  var filtered;
  if (filter === "private") {
    filtered = (window.qtPrivateFeedCache || []);
  } else if (filter === "group") {
    // 소그룹: 공개범위가 소그룹이면서, 나와 교회+소그룹 이름이 둘 다 같은 사람 글만
    filtered = allPosts.filter(function (p) {
      return (
        p.privacy === "group" &&
        myChurch && myGroupName &&
        (p.churchName || "") === myChurch &&
        (p.groupName || "") === myGroupName
      );
    });
  } else if (filter === "church") {
    // 교회 전체: 공개범위가 교회이면서, 나와 교회 이름이 같은 사람 글만
    filtered = allPosts.filter(function (p) {
      return p.privacy === "church" && myChurch && (p.churchName || "") === myChurch;
    });
  } else {
    // 전체 공개는 교회/소그룹 상관없이 그대로 다 보여줌
    filtered = allPosts.filter(function (p) { return p.privacy === filter; });
  }

  renderHomeFeedPreview(filtered);
  renderFullFeed(filtered);
};

function renderHomeFeedPreview(posts) {
  var list = document.getElementById("home-feed-list");
  if (!list) return;
  var top = posts; // 박스 안에서 스크롤로 더 볼 수 있도록 전체 다 렌더링

  if (!top.length) {
    var tabIdx = window.currentFeedTab || 0;
    var emptyMsgs = [
      "아직 소그룹에 올라온 묵상이 없어요.",
      "나만보기로 저장한 묵상이 없어요.",
      "교회 전체로 공개한 묵상이 없어요.",
      "전체 공개된 묵상이 없어요."
    ];
    list.innerHTML =
      '<div style="padding:24px 12px;text-align:center;color:var(--text-muted);font-size:12px;">' + (emptyMsgs[tabIdx] || emptyMsgs[0]) + '</div>';
    return;
  }

  var myUid = window.qtUser ? window.qtUser.uid : null;

  list.innerHTML = top
    .map(function (p) {
      var liked = !!(myUid && p.likedBy && p.likedBy.indexOf(myUid) !== -1);
      var createdDate = p.createdAt && p.createdAt.toDate ? p.createdAt.toDate() : new Date();
      var shortText = p.text.length > 40 ? p.text.slice(0, 40) + "…" : p.text;
      return (
        '<div class="feed-item" data-detail-id="' + p.id + '" style="cursor:pointer;">' +
        avatarHtml(p.authorName, p.authorPhoto, p.uid, "avatar") +
        "<div>" +
        '<div><span class="feed-name">' + escapeHtml(p.authorName) + '</span><span class="feed-time">· ' + relativeTimeFrom(createdDate) + "</span></div>" +
        '<div class="feed-text">' + escapeHtml(shortText) + "</div>" +
        '<div class="feed-reactions"><span class="feed-like-btn' + (liked ? " fp-liked" : "") + '" data-like-id="' + p.id + '">♥ <span class="like-count">' + (p.likeCount || 0) + '</span></span><span>💬 <span data-comment-count="' + p.id + '">' + (p.commentCount || 0) + '</span></span></div>' +
        "</div>" +
        "</div>"
      );
    })
    .join("");
}

function renderFullFeed(posts) {
  var list = document.getElementById("fp-list");
  if (!list) return;

  if (!posts.length) {
    var tabIdx = window.currentFeedTab || 0;
    var churchSet = !!(window.qtChurchProfile && window.qtChurchProfile.churchName);
    var groupSet = !!(window.qtChurchProfile && window.qtChurchProfile.groupName);
    var emptyMsgs = [
      churchSet && groupSet
        ? "아직 소그룹에 올라온 묵상이 없어요.\n가장 먼저 나눠보세요 🙌"
        : "마이페이지에서 교회/소그룹을 먼저 설정해주세요.\n같은 소그룹 사람들과 이름을 맞춰서 입력하면 돼요.",
      "나만보기로 저장한 묵상이 없어요.\n묵상 후 공개 범위를 나만보기로 설정해보세요.",
      churchSet
        ? "교회 전체로 공개한 묵상이 없어요."
        : "마이페이지에서 교회 이름을 먼저 설정해주세요.",
      "전체 공개된 묵상이 없어요."
    ];
    var msg = (emptyMsgs[tabIdx] || emptyMsgs[0]).replace("\n", "<br>");
    list.innerHTML =
      '<div style="padding:40px 20px;text-align:center;color:var(--text-muted);font-size:13px;">' + msg + '</div>';
    return;
  }

  var myUid = window.qtUser ? window.qtUser.uid : null;

  list.innerHTML = posts
    .map(function (p) {
      var liked = !!(myUid && p.likedBy && p.likedBy.indexOf(myUid) !== -1);
      var createdDate = p.createdAt && p.createdAt.toDate ? p.createdAt.toDate() : new Date();
      return (
        '<div class="fp-card" data-detail-id="' + p.id + '">' +
        '<div class="fp-card-top">' +
        avatarHtml(p.authorName, p.authorPhoto, p.uid, "fp-avatar") +
        '<div class="fp-info">' +
        '<div class="fp-name">' + escapeHtml(p.authorName) + ' <span class="fp-badge">' + (privacyLabelMap[p.privacy] || "") + '</span></div>' +
        '<div class="fp-time">' + relativeTimeFrom(createdDate) + (p.verseRef ? " · " + escapeHtml(p.verseRef) : "") + "</div>" +
        "</div>" +
        "</div>" +
        '<div class="fp-content">' + escapeHtml(p.text) + "</div>" +
        '<div class="fp-actions">' +
        '<div class="fp-action-btn' + (liked ? " fp-liked" : "") + '" data-like-id="' + p.id + '">♥ <span class="like-count">' + (p.likeCount || 0) + "</span></div>" +
        '<div class="fp-action-btn">💬 <span data-comment-count="' + p.id + '">' + (p.commentCount || 0) + "</span></div>" +
        "</div>" +
        "</div>"
      );
    })
    .join("");
}

// 좋아요 처리 (실제 토글 로직)
async function handleLikeClick(btn, docId) {
  var db = window.qtDb;
  var user = window.qtUser;
  if (!db || !user) {
    console.warn("[오늘의QT] 좋아요: 아직 로그인 처리 중이에요");
    return;
  }

  var posts = window.qtGroupFeedCache || [];
  var post = posts.find(function (p) { return p.id === docId; });
  if (!post) {
    console.warn("[오늘의QT] 좋아요: 해당 게시물을 찾을 수 없어요", docId);
    return;
  }

  var liked = !!(post.likedBy && post.likedBy.indexOf(user.uid) !== -1);

  // 화면 먼저 바꾸고(낙관적 업데이트), 서버에는 뒤이어 반영
  if (liked) {
    post.likedBy = post.likedBy.filter(function (u) { return u !== user.uid; });
    post.likeCount = Math.max(0, (post.likeCount || 1) - 1);
  } else {
    post.likedBy = (post.likedBy || []).concat([user.uid]);
    post.likeCount = (post.likeCount || 0) + 1;
  }

  // 같은 글이 홈 미리보기 + 나눔 페이지 양쪽에 동시에 떠있을 수 있어서
  // data-like-id가 같은 요소를 전부 찾아서 같이 갱신
  document.querySelectorAll('[data-like-id="' + docId + '"]').forEach(function (el) {
    el.classList.toggle("fp-liked", !liked);
    var countEl = el.querySelector(".like-count");
    if (countEl) countEl.textContent = post.likeCount;
  });

  try {
    var ref = doc(db, "meditations", docId);
    await updateDoc(ref, {
      likedBy: liked ? arrayRemove(user.uid) : arrayUnion(user.uid),
      likeCount: increment(liked ? -1 : 1),
    });
    console.log("[오늘의QT] 좋아요 처리 완료:", docId);

    // 좋아요를 새로 누른 경우에만 글 작성자에게 알림 (취소는 알림 안 보냄)
    if (!liked) {
      createNotification(post.uid, "like", {
        postId: docId,
        preview: (post.text || "").slice(0, 30),
      });
    }
  } catch (err) {
    console.error("[오늘의QT] 좋아요 처리 실패:", err.code, err.message);
  }
}

// 카드 클릭 -> 상세보기 시트 열기 (기존에 만들어져 있던 fp-detail-overlay 재사용)
function openRealFeedDetail(docId) {
  var posts = window.qtGroupFeedCache || [];
  var p = posts.find(function (post) { return post.id === docId; });
  if (!p) return;

  var body = document.getElementById("fp-detail-body");
  var overlay = document.getElementById("fp-detail-overlay");
  if (!body || !overlay) return;

  var myUid = window.qtUser ? window.qtUser.uid : null;
  var liked = !!(myUid && p.likedBy && p.likedBy.indexOf(myUid) !== -1);
  var createdDate = p.createdAt && p.createdAt.toDate ? p.createdAt.toDate() : new Date();

  var extraHtml = "";
  if (p.thanks && p.thanks.length) {
    extraHtml +=
      '<div class="fp-detail-comment-title">🙏 감사 제목</div>' +
      '<div class="fp-detail-content">' + p.thanks.map(escapeHtml).join("<br>") + "</div>";
  }
  if (p.prayer) {
    extraHtml +=
      '<div class="fp-detail-comment-title">🕊️ 기도제목</div>' +
      '<div class="fp-detail-content">' + escapeHtml(p.prayer) + "</div>";
  }

  body.innerHTML =
    '<div class="fp-card-top" style="margin-bottom:12px;">' +
    avatarHtml(p.authorName, p.authorPhoto, p.uid, "fp-avatar") +
    '<div class="fp-info"><div class="fp-name">' + escapeHtml(p.authorName) + ' <span class="fp-badge">' + (privacyLabelMap[p.privacy] || "") + '</span></div>' +
    '<div class="fp-time">' + relativeTimeFrom(createdDate) + "</div></div>" +
    "</div>" +
    (p.verseRef ? '<div class="fp-detail-quote">' + escapeHtml(p.verseRef) + "</div>" : "") +
    '<div class="fp-detail-content">' + escapeHtml(p.text) + "</div>" +
    extraHtml +
    '<div class="fp-actions" style="margin-top:14px;">' +
    '<div class="fp-action-btn' + (liked ? " fp-liked" : "") + '" data-like-id="' + p.id + '">♥ <span class="like-count">' + (p.likeCount || 0) + "</span></div>" +
    "</div>" +
    '<div class="fp-detail-comment-title" style="margin-top:18px;" id="comment-title-' + p.id + '">댓글</div>' +
    '<div id="comment-list-' + p.id + '" style="min-height:40px;"></div>' +
    '<div class="fp-comment-input-row">' +
    '<input type="text" class="fp-comment-input" id="comment-input-' + p.id + '" placeholder="따뜻한 댓글을 남겨보세요...">' +
    '<button class="fp-comment-send" data-comment-post="' + p.id + '">↑</button>' +
    "</div>";

  overlay.classList.add("on");

  // 댓글 불러오기
  loadComments(p.id);
}

// 이벤트 위임: 좋아요 버튼 클릭과 카드 클릭(상세보기)을 한 곳에서 우선순위 있게 처리
// (좋아요 버튼이 카드 안에 있어서, 좋아요를 눌렀을 때 상세보기까지 같이 열리지 않도록
//  좋아요 버튼 클릭을 먼저 확인하고, 맞으면 거기서 처리를 끝냄)
document.addEventListener("click", function (e) {
  var likeBtn = e.target.closest ? e.target.closest("[data-like-id]") : null;
  if (likeBtn) {
    var docId = likeBtn.getAttribute("data-like-id");
    console.log("[오늘의QT] 좋아요 버튼 클릭 감지:", docId);
    handleLikeClick(likeBtn, docId);
    return;
  }

  var card = e.target.closest ? e.target.closest("[data-detail-id]") : null;
  if (card) {
    openRealFeedDetail(card.getAttribute("data-detail-id"));
  }
});

// ============================================================
// 믿음 성장 리포트 캘린더
// ------------------------------------------------------------
// 마이페이지의 "믿음 성장 리포트" 캘린더를 실제 Firestore 데이터로
// 채웁니다. 본인이 작성한 모든 묵상(공개범위 무관)을 uid 기준으로
// 불러와 dateKey별로 매핑하고, 월 단위로 도장(done)을 찍습니다.
// 날짜를 탭하면 그날 작성한 묵상을 상세 팝업으로 보여줍니다.
// ============================================================

var reportViewYear, reportViewMonth; // reportViewMonth는 0-indexed
(function initReportViewDate() {
  var now = new Date();
  reportViewYear = now.getFullYear();
  reportViewMonth = now.getMonth();
})();

var qtMyMeditationsCache = null; // { dateKey: postData } (달력용, 같은 날은 최신 글만)
var qtMyMeditationsList = null; // [postData, ...] (전체보기용, 최신순 전체 글)

var privacyLabelMap = {
  group: "👥 소그룹",
  private: "🔒 나만보기",
  church: "⛪ 교회 전체",
  public: "🌍 전체 공개",
};

// 본인이 작성한 모든 묵상을 한 번에 불러와 dateKey -> 글 로 매핑
// (동시에 "전체보기" 리스트용 최신순 전체 배열도 함께 만들어 캐싱)
async function loadMyMeditationsAll() {
  var db = window.qtDb;
  var user = window.qtUser;
  if (!db || !user) return {};

  var map = {};
  var list = [];
  try {
    var q = query(collection(db, "meditations"), where("uid", "==", user.uid));
    var snap = await getDocs(q);
    snap.forEach(function (docSnap) {
      var d = docSnap.data();
      d.id = docSnap.id;
      list.push(d);
      if (!d.dateKey) return;
      var existing = map[d.dateKey];
      if (!existing) {
        map[d.dateKey] = d;
      } else {
        var et = existing.createdAt && existing.createdAt.toMillis ? existing.createdAt.toMillis() : 0;
        var nt = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0;
        if (nt >= et) map[d.dateKey] = d; // 같은 날 여러 번 썼으면 최신 글 사용
      }
    });
  } catch (err) {
    console.error("[오늘의QT] 리포트용 묵상 목록 불러오기 실패:", err.code, err.message);
  }

  list.sort(function (a, b) {
    var at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    var bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    if (bt !== at) return bt - at;
    return (b.dateKey || "").localeCompare(a.dateKey || "");
  });

  qtMyMeditationsCache = map;
  qtMyMeditationsList = list;
  return map;
}

function dateKeyOfYMD(y, m, day) {
  return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

// 캘린더 다시 그리기 (월 이동, 최초 진입, 저장 후 갱신 시 호출)
async function renderReportCalendar() {
  var grid = document.getElementById("report-calendar-grid");
  var monthLabel = document.getElementById("report-month-label");
  var badge = document.getElementById("report-badge");
  var pctEl = document.getElementById("report-pct");
  var barFill = document.getElementById("report-bar-fill");
  if (!grid) return; // 마이페이지 마크업이 없는 화면이면 조용히 종료

  if (!qtMyMeditationsCache) {
    await loadMyMeditationsAll();
  }
  var map = qtMyMeditationsCache || {};

  var y = reportViewYear, m = reportViewMonth;
  if (monthLabel) monthLabel.textContent = y + "년 " + (m + 1) + "월";

  var now = new Date();
  var isCurrentMonth = y === now.getFullYear() && m === now.getMonth();
  var daysInMonth = new Date(y, m + 1, 0).getDate();

  var doneCount = 0;
  for (var day = 1; day <= daysInMonth; day++) {
    if (map[dateKeyOfYMD(y, m, day)]) doneCount++;
  }

  if (badge) {
    badge.textContent = "이번 달 " + doneCount + "일 묵상" + (doneCount > 0 ? " 🎉" : "");
  }
  var denom = isCurrentMonth ? now.getDate() : daysInMonth;
  var pct = denom > 0 ? Math.round((doneCount / denom) * 100) : 0;
  if (pct > 100) pct = 100;
  if (pctEl) pctEl.textContent = pct + "%";
  if (barFill) barFill.style.width = pct + "%";

  // 요일 헤더 (월요일 시작)
  var html =
    '<div class="my-cal-row">' +
    ["월", "화", "수", "목", "금", "토", "일"]
      .map(function (d) { return '<div class="my-cal-day label">' + d + "</div>"; })
      .join("") +
    "</div>";

  var firstDow = new Date(y, m, 1).getDay(); // 0=일 ... 6=토
  var leadEmpty = firstDow === 0 ? 6 : firstDow - 1; // 월요일 시작 기준 빈 칸 수

  var cells = [];
  for (var i = 0; i < leadEmpty; i++) cells.push('<div class="my-cal-day empty"></div>');
  for (var day2 = 1; day2 <= daysInMonth; day2++) {
    var dk = dateKeyOfYMD(y, m, day2);
    var isToday = isCurrentMonth && day2 === now.getDate();
    var hasEntry = !!map[dk];
    var cls = "my-cal-day" + (hasEntry ? " done" : "") + (isToday ? " today" : "");
    cells.push('<div class="' + cls + '" data-date-key="' + dk + '">' + day2 + "</div>");
  }
  while (cells.length % 7 !== 0) cells.push('<div class="my-cal-day empty"></div>');

  for (var r = 0; r < cells.length; r += 7) {
    html += '<div class="my-cal-row">' + cells.slice(r, r + 7).join("") + "</div>";
  }

  grid.innerHTML = html;
}
window.renderReportCalendar = renderReportCalendar;

window.reportPrevMonth = function () {
  reportViewMonth--;
  if (reportViewMonth < 0) {
    reportViewMonth = 11;
    reportViewYear--;
  }
  renderReportCalendar();
};

window.reportNextMonth = function () {
  reportViewMonth++;
  if (reportViewMonth > 11) {
    reportViewMonth = 0;
    reportViewYear++;
  }
  renderReportCalendar();
};

// 캘린더에서 기록 있는 날짜(도장 찍힌 날) 탭 -> 그날 묵상 상세 팝업
document.addEventListener("click", function (e) {
  var cell = e.target.closest ? e.target.closest("#report-calendar-grid .my-cal-day.done") : null;
  if (!cell) return;
  var dk = cell.getAttribute("data-date-key");
  var post = qtMyMeditationsCache && qtMyMeditationsCache[dk];
  if (post) openMyMeditationDetail(post);
});

// 기존 fp-detail-overlay를 재사용해 "내 묵상" 상세 팝업 표시
// (openRealFeedDetail과 달리 소그룹 피드 캐시에 없는 나만보기 글도 그대로 열 수 있음)
function openMyMeditationDetail(p) {
  var body = document.getElementById("fp-detail-body");
  var overlay = document.getElementById("fp-detail-overlay");
  if (!body || !overlay) return;

  var myUid = window.qtUser ? window.qtUser.uid : null;
  var liked = !!(myUid && p.likedBy && p.likedBy.indexOf(myUid) !== -1);
  var createdDate = p.createdAt && p.createdAt.toDate ? p.createdAt.toDate() : new Date();
  var privacyLabel = privacyLabelMap[p.privacy] || "";

  var extraHtml = "";
  if (p.thanks && p.thanks.length) {
    extraHtml +=
      '<div class="fp-detail-comment-title">🙏 감사 제목</div>' +
      '<div class="fp-detail-content">' + p.thanks.map(escapeHtml).join("<br>") + "</div>";
  }
  if (p.prayer) {
    extraHtml +=
      '<div class="fp-detail-comment-title">🕊️ 기도제목</div>' +
      '<div class="fp-detail-content">' + escapeHtml(p.prayer) + "</div>";
  }

  body.innerHTML =
    '<div class="fp-card-top" style="margin-bottom:12px;">' +
    avatarHtml(p.authorName, p.authorPhoto, p.uid, "fp-avatar") +
    '<div class="fp-info"><div class="fp-name">' + escapeHtml(p.authorName) + ' <span class="fp-badge">' + privacyLabel + '</span></div>' +
    '<div class="fp-time">' + relativeTimeFrom(createdDate) + "</div></div>" +
    "</div>" +
    (p.verseRef ? '<div class="fp-detail-quote">' + escapeHtml(p.verseRef) + "</div>" : "") +
    '<div class="fp-detail-content">' + escapeHtml(p.text) + "</div>" +
    extraHtml +
    '<div class="fp-actions" style="margin-top:14px;">' +
    '<div class="fp-action-btn' + (liked ? " fp-liked" : "") + '" data-like-id="' + p.id + '">♥ <span class="like-count">' + (p.likeCount || 0) + "</span></div>" +
    "</div>" +
    '<div class="fp-detail-comment-title" style="margin-top:18px;" id="comment-title-' + p.id + '">댓글</div>' +
    '<div id="comment-list-' + p.id + '" style="min-height:40px;"></div>' +
    '<div class="fp-comment-input-row">' +
    '<input type="text" class="fp-comment-input" id="comment-input-' + p.id + '" placeholder="따뜻한 댓글을 남겨보세요...">' +
    '<button class="fp-comment-send" data-comment-post="' + p.id + '">↑</button>' +
    "</div>";

  overlay.classList.add("on");
  loadComments(p.id);
}

// ------------------------------------------------------------
// "내가 쓴 묵상 전체보기" — 월별 그룹 리스트 + 수정/삭제
// ------------------------------------------------------------
async function renderMyMeditationsList() {
  var container = document.getElementById("my-meds-full-list");
  if (!container) return;

  if (!qtMyMeditationsList) {
    await loadMyMeditationsAll();
  }
  var list = qtMyMeditationsList || [];

  if (list.length === 0) {
    container.innerHTML = '<div class="my-meds-empty">아직 작성한 묵상이 없어요.</div>';
    return;
  }

  var groups = {}; // "YYYY-MM" -> [post, ...]
  var order = [];
  list.forEach(function (p) {
    var key = (p.dateKey || "").slice(0, 7);
    if (!groups[key]) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(p);
  });

  var html = "";
  order.forEach(function (key) {
    var parts = key.split("-");
    var label = parts[0] && parts[1] ? parts[0] + "년 " + parseInt(parts[1], 10) + "월" : "날짜 미상";
    html += '<div class="my-med-month-header">' + label + "</div>";
    html += '<div class="my-meds-list">';
    groups[key].forEach(function (p) {
      var dayNum = p.dateKey ? parseInt(p.dateKey.slice(8, 10), 10) : "";
      var privacyLabel = privacyLabelMap[p.privacy] || "";
      html +=
        '<div class="my-med-item" data-post-id="' + p.id + '">' +
        '<div class="my-med-date">' + dayNum + "일" + (p.verseRef ? " · " + escapeHtml(p.verseRef) : "") + "</div>" +
        '<div class="my-med-text">' + escapeHtml(p.text || "") + "</div>" +
        '<div class="my-med-footer">' +
        '<span class="my-med-privacy">' + privacyLabel + "</span>" +
        '<span class="my-med-actions">' +
        '<span class="my-med-edit-btn" data-edit-id="' + p.id + '">✏️ 수정</span>' +
        '<span class="my-med-delete-btn" data-delete-id="' + p.id + '">🗑 삭제</span>' +
        "</span>" +
        "</div>" +
        "</div>";
    });
    html += "</div>";
  });

  container.innerHTML = html;
}
window.renderMyMeditationsList = renderMyMeditationsList;

// 전체보기 목록에서 글 탭 -> 상세 팝업 / 수정 버튼 -> 수정 모달 / 삭제 버튼 -> 삭제
document.addEventListener("click", function (e) {
  var editBtn = e.target.closest ? e.target.closest(".my-med-edit-btn") : null;
  if (editBtn) {
    e.stopPropagation();
    var editId = editBtn.getAttribute("data-edit-id");
    var editPost = (qtMyMeditationsList || []).find(function (p) { return p.id === editId; });
    if (editPost) openEditMeditationModal(editPost);
    return;
  }

  var delBtn = e.target.closest ? e.target.closest(".my-med-delete-btn") : null;
  if (delBtn) {
    e.stopPropagation();
    var delId = delBtn.getAttribute("data-delete-id");
    deleteMyMeditation(delId);
    return;
  }

  var listItem = e.target.closest ? e.target.closest("#my-meds-full-list .my-med-item[data-post-id]") : null;
  if (listItem) {
    var postId = listItem.getAttribute("data-post-id");
    var post = (qtMyMeditationsList || []).find(function (p) { return p.id === postId; });
    if (post) openMyMeditationDetail(post);
  }
});

// 수정 모달 열기 (기존 값 채워넣기)
function openEditMeditationModal(p) {
  var overlay = document.getElementById("edit-med-overlay");
  if (!overlay) return;

  overlay.setAttribute("data-editing-id", p.id);

  var verseRefEl = document.getElementById("editmed-verse-ref");
  if (verseRefEl) verseRefEl.textContent = p.verseRef || "";

  var textEl = document.getElementById("editmed-text");
  if (textEl) textEl.value = p.text || "";

  var thanksInputs = overlay.querySelectorAll(".editmed-thanks-input");
  thanksInputs.forEach(function (inp, idx) {
    inp.value = (p.thanks && p.thanks[idx]) || "";
  });

  var prayerEl = document.getElementById("editmed-prayer");
  if (prayerEl) prayerEl.value = p.prayer || "";

  overlay.querySelectorAll(".editmed-privacy-btn").forEach(function (btn) {
    btn.classList.toggle("on", btn.getAttribute("data-val") === p.privacy);
  });

  overlay.classList.add("on");
}

// 수정 저장
window.saveEditedMeditation = async function () {
  var overlay = document.getElementById("edit-med-overlay");
  var id = overlay ? overlay.getAttribute("data-editing-id") : null;
  var db = window.qtDb;
  if (!id || !db) return;

  var textEl = document.getElementById("editmed-text");
  var text = textEl ? textEl.value.trim() : "";
  if (!text) {
    alert("묵상 내용을 입력해주세요.");
    return;
  }

  var thanks = [];
  overlay.querySelectorAll(".editmed-thanks-input").forEach(function (inp) {
    if (inp.value.trim()) thanks.push(inp.value.trim());
  });

  var prayerEl = document.getElementById("editmed-prayer");
  var prayer = prayerEl ? prayerEl.value.trim() : "";

  var privacyBtn = overlay.querySelector(".editmed-privacy-btn.on");
  var privacy = privacyBtn ? privacyBtn.getAttribute("data-val") : "group";

  try {
    await updateDoc(doc(db, "meditations", id), {
      text: text,
      thanks: thanks,
      prayer: prayer,
      privacy: privacy,
    });
  } catch (err) {
    console.error("[오늘의QT] 묵상 수정 실패:", err.code, err.message);
    alert("수정에 실패했어요. 잠시 후 다시 시도해주세요.");
    return;
  }

  overlay.classList.remove("on");

  // 캐시 무효화 + 관련 화면 전부 갱신
  qtMyMeditationsCache = null;
  qtMyMeditationsList = null;
  await refreshStats();
  if (window.loadGroupFeed) await window.loadGroupFeed();
  if (window.renderReportCalendar) await window.renderReportCalendar();
  await renderMyMeditationsList();
};

// 삭제 (확인 후 진행)
async function deleteMyMeditation(id) {
  var db = window.qtDb;
  if (!db || !id) return;

  var confirmed = window.confirm("이 묵상을 삭제할까요?\n삭제하면 되돌릴 수 없어요.");
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "meditations", id));
  } catch (err) {
    console.error("[오늘의QT] 묵상 삭제 실패:", err.code, err.message);
    alert("삭제에 실패했어요. 잠시 후 다시 시도해주세요.");
    return;
  }

  qtMyMeditationsCache = null;
  qtMyMeditationsList = null;
  await refreshStats();
  if (window.loadGroupFeed) await window.loadGroupFeed();
  if (window.renderReportCalendar) await window.renderReportCalendar();
  await renderMyMeditationsList();
}

// ============================================================
// 알림 (좋아요 / 댓글 / 공지사항)
// ------------------------------------------------------------
// notifications 컬렉션: 좋아요·댓글 받았을 때 자동 생성 (수신자 uid 기준)
// announcements 컬렉션: 프리미엄 소식 등 전체 공지 (Firebase 콘솔에서 직접 추가,
//                       읽음 여부는 기기에 로컬로 저장)
// ============================================================

window.qtNotifications = null;

// 캐시들(소그룹/나만보기/전체보기) 중에서 postId로 글 찾기 (댓글 알림 대상 찾을 때 사용)
function findCachedPost(postId) {
  var sources = [window.qtGroupFeedCache, window.qtPrivateFeedCache, qtMyMeditationsList];
  for (var i = 0; i < sources.length; i++) {
    var arr = sources[i];
    if (!arr) continue;
    var found = arr.find(function (p) { return p.id === postId; });
    if (found) return found;
  }
  return null;
}

// 알림 생성 (수신자가 나 자신이면 알림 생성 안 함)
async function createNotification(toUid, type, extra) {
  var db = window.qtDb;
  var user = window.qtUser;
  if (!db || !user || !toUid || toUid === user.uid) return;

  var profile = window.qtGetProfile ? window.qtGetProfile() : window.qtProfile;

  var payload = {
    uid: toUid,
    type: type,
    fromUid: user.uid,
    fromName: (profile && profile.displayName) || "이름 없는 친구",
    fromPhoto: (profile && profile.photoURL) || "",
    read: false,
    createdAt: serverTimestamp(),
  };
  if (extra) {
    for (var key in extra) payload[key] = extra[key];
  }

  try {
    await addDoc(collection(db, "notifications"), payload);
  } catch (err) {
    console.error("[오늘의QT] 알림 생성 실패:", err.code, err.message);
  }
}

// 개인 알림 + 전체 공지사항을 합쳐서 최신순으로 불러오기
async function loadNotifications() {
  var db = window.qtDb;
  var user = window.qtUser;
  if (!db || !user) return [];

  var list = [];

  try {
    var q = query(collection(db, "notifications"), where("uid", "==", user.uid));
    var snap = await getDocs(q);
    snap.forEach(function (docSnap) {
      var d = docSnap.data();
      d.id = docSnap.id;
      list.push(d);
    });
  } catch (err) {
    console.error("[오늘의QT] 알림 목록 불러오기 실패:", err.code, err.message);
  }

  try {
    var readAnnouncements = JSON.parse(localStorage.getItem("qtReadAnnouncements") || "[]");
    var snapA = await getDocs(collection(db, "announcements"));
    snapA.forEach(function (docSnap) {
      var d = docSnap.data();
      d.id = docSnap.id;
      d.type = "announcement";
      d.read = readAnnouncements.indexOf(docSnap.id) !== -1;
      list.push(d);
    });
  } catch (err) {
    console.error("[오늘의QT] 공지사항 불러오기 실패:", err.code, err.message);
  }

  list.sort(function (a, b) {
    var at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    var bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    return bt - at;
  });

  window.qtNotifications = list;
  updateBellDot();
  return list;
}
window.loadNotifications = loadNotifications;

// 안 읽은 알림이 하나라도 있으면 벨에 빨간 점 표시
function updateBellDot() {
  var dot = document.getElementById("bell-dot");
  if (!dot) return;
  var hasUnread = (window.qtNotifications || []).some(function (n) { return !n.read; });
  dot.style.display = hasUnread ? "block" : "none";
}

function notifText(n) {
  if (n.type === "like") return (n.fromName || "누군가") + "님이 회원님의 묵상에 좋아요를 눌렀어요.";
  if (n.type === "comment") return (n.fromName || "누군가") + "님이 회원님의 묵상에 댓글을 남겼어요.";
  if (n.type === "announcement") return n.title || "새 소식이 있어요.";
  return "";
}

function notifIcon(n) {
  if (n.type === "like") return "♥";
  if (n.type === "comment") return "💬";
  if (n.type === "announcement") return "📢";
  return "🔔";
}

// 벨 아이콘 클릭 -> 알림 목록 오버레이 열기 + 전부 읽음 처리
async function openNotifications() {
  var overlay = document.getElementById("notif-overlay");
  var body = document.getElementById("notif-body");
  if (!overlay || !body) return;

  body.innerHTML = '<div class="notif-empty">불러오는 중...</div>';
  overlay.classList.add("on");

  if (!window.qtNotifications) {
    await loadNotifications();
  }
  var list = window.qtNotifications || [];

  if (!list.length) {
    body.innerHTML = '<div class="notif-empty">아직 알림이 없어요.</div>';
  } else {
    body.innerHTML = list
      .map(function (n) {
        var createdDate = n.createdAt && n.createdAt.toDate ? n.createdAt.toDate() : new Date();
        var clickable = (n.type === "like" || n.type === "comment") && n.postId ? true : (n.type === "announcement" && n.link ? true : false);
        return (
          '<div class="notif-item' + (n.read ? "" : " notif-unread") + (clickable ? " notif-clickable" : "") + '"' +
          (n.postId ? ' data-post-id="' + n.postId + '"' : "") +
          (n.link ? ' data-link="' + escapeHtml(n.link) + '"' : "") +
          ">" +
          '<div class="notif-icon">' + notifIcon(n) + "</div>" +
          '<div class="notif-main">' +
          '<div class="notif-text">' + escapeHtml(notifText(n)) + "</div>" +
          (n.preview ? '<div class="notif-preview">' + escapeHtml(n.preview) + "</div>" : "") +
          (n.body ? '<div class="notif-preview">' + escapeHtml(n.body) + "</div>" : "") +
          '<div class="notif-time">' + relativeTimeFrom(createdDate) + "</div>" +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  await markAllNotificationsRead();
}
window.openNotifications = openNotifications;

// 목록을 열람하면 개인 알림은 서버에 읽음 처리, 공지사항은 이 기기에 읽음 기록
async function markAllNotificationsRead() {
  var db = window.qtDb;
  var list = window.qtNotifications || [];
  if (!list.length) return;

  var readAnnouncements = JSON.parse(localStorage.getItem("qtReadAnnouncements") || "[]");
  var updatePromises = [];

  list.forEach(function (n) {
    if (n.read) return;
    if (n.type === "announcement") {
      if (readAnnouncements.indexOf(n.id) === -1) readAnnouncements.push(n.id);
      n.read = true;
    } else {
      n.read = true;
      updatePromises.push(
        updateDoc(doc(db, "notifications", n.id), { read: true }).catch(function (err) {
          console.error("[오늘의QT] 알림 읽음 처리 실패:", err.code, err.message);
        })
      );
    }
  });

  localStorage.setItem("qtReadAnnouncements", JSON.stringify(readAnnouncements));
  await Promise.all(updatePromises);
  updateBellDot();
}

// notifId를 postId로 갖는 글 찾기: 캐시에 없으면 Firestore에서 직접 조회
async function getPostById(postId) {
  var cached = findCachedPost(postId);
  if (cached) return cached;

  var db = window.qtDb;
  if (!db || !postId) return null;
  try {
    var snap = await getDoc(doc(db, "meditations", postId));
    if (snap.exists()) {
      var d = snap.data();
      d.id = snap.id;
      return d;
    }
  } catch (err) {
    console.error("[오늘의QT] 알림 대상 글 조회 실패:", err.code, err.message);
  }
  return null;
}

// 알림 항목 탭 -> 좋아요/댓글 알림은 그 글 상세 팝업으로, 공지사항은 링크가 있으면 새 창으로 열기
document.addEventListener("click", async function (e) {
  var item = e.target.closest ? e.target.closest(".notif-item.notif-clickable") : null;
  if (!item) return;

  var link = item.getAttribute("data-link");
  if (link) {
    window.open(link, "_blank");
    return;
  }

  var postId = item.getAttribute("data-post-id");
  if (!postId) return;

  var overlay = document.getElementById("notif-overlay");
  if (overlay) overlay.classList.remove("on");

  var post = await getPostById(postId);
  if (post) {
    openMyMeditationDetail(post);
  } else {
    alert("글을 찾을 수 없어요. 삭제된 글일 수 있어요.");
  }
});

// ============================================================
// 댓글 기능
// ============================================================

// 댓글 불러오기 + 렌더링
async function loadComments(postId) {
  var db = window.qtDb;
  if (!db) return;

  var listEl = document.getElementById("comment-list-" + postId);
  var titleEl = document.getElementById("comment-title-" + postId);
  if (!listEl) return;

  listEl.innerHTML = '<div style="padding:12px 0;text-align:center;color:var(--text-muted);font-size:12px;">불러오는 중...</div>';

  try {
    var q = query(
      collection(db, "meditations", postId, "comments"),
      orderBy("createdAt", "asc")
    );
    var snap = await getDocs(q);
    var comments = [];
    snap.forEach(function (d) {
      var c = d.data();
      c.id = d.id;
      comments.push(c);
    });

    if (titleEl) titleEl.textContent = "댓글 " + (comments.length ? comments.length + "개" : "");

    if (!comments.length) {
      listEl.innerHTML = '<div style="padding:14px 0;text-align:center;color:var(--text-muted);font-size:12px;">첫 댓글을 남겨보세요 🙂</div>';
      return;
    }

    listEl.innerHTML = comments.map(function (c) {
      var date = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate() : new Date();
      return (
        '<div class="fp-detail-comment">' +
        avatarHtml(c.authorName, c.authorPhoto, c.uid, "fp-detail-comment-av") +
        '<div class="fp-detail-comment-text">' +
        '<div class="fp-detail-comment-name">' + escapeHtml(c.authorName) + ' <span style="font-weight:400;color:var(--text-muted);">' + relativeTimeFrom(date) + "</span></div>" +
        escapeHtml(c.text) +
        "</div></div>"
      );
    }).join("");

  } catch (err) {
    console.error("[오늘의QT] 댓글 불러오기 실패:", err.code, err.message);
    listEl.innerHTML = '<div style="padding:12px 0;text-align:center;color:var(--text-muted);font-size:12px;">댓글을 불러오지 못했어요.</div>';
  }
}

// 댓글 저장
async function saveComment(postId) {
  var db = window.qtDb;
  var user = window.qtUser;
  if (!db || !user) return;

  var inputEl = document.getElementById("comment-input-" + postId);
  if (!inputEl) return;

  var text = inputEl.value.trim();
  if (!text) return;

  var profile = window.qtGetProfile ? window.qtGetProfile() : window.qtProfile;

  inputEl.disabled = true;
  try {
    await addDoc(collection(db, "meditations", postId, "comments"), {
      uid: user.uid,
      authorName: (profile && profile.displayName) || "이름 없는 친구",
      authorPhoto: (profile && profile.photoURL) || "",
      text: text,
      createdAt: serverTimestamp(),
    });

    // 부모 묵상의 댓글 수도 같이 올려줌 (홈/나눔 피드 카드에 반영)
    try {
      await updateDoc(doc(db, "meditations", postId), {
        commentCount: increment(1),
      });
      // 캐시에도 반영
      var posts = window.qtGroupFeedCache || [];
      var post = posts.find(function (p) { return p.id === postId; });
      if (post) {
        post.commentCount = (post.commentCount || 0) + 1;
        // 홈/나눔 피드 댓글 수 표시 업데이트
        document.querySelectorAll('[data-comment-count="' + postId + '"]').forEach(function (el) {
          el.textContent = post.commentCount;
        });
      }
    } catch (e) {
      console.error("[오늘의QT] commentCount 업데이트 실패:", e.code, e.message);
    }

    inputEl.value = "";
    console.log("[오늘의QT] 댓글 저장 완료");

    // 글 작성자에게 댓글 알림 (본인 글에 본인이 단 댓글은 createNotification 내부에서 자동 제외)
    var ownerPost = findCachedPost(postId);
    if (ownerPost) {
      createNotification(ownerPost.uid, "comment", {
        postId: postId,
        preview: text.slice(0, 30),
      });
    }

    // 댓글 목록 새로고침
    await loadComments(postId);

  } catch (err) {
    console.error("[오늘의QT] 댓글 저장 실패:", err.code, err.message);
    alert("댓글 저장 중 문제가 생겼어요. 다시 시도해주세요.");
  } finally {
    inputEl.disabled = false;
    inputEl.focus();
  }
}

// 댓글 전송 버튼 클릭 이벤트 위임
document.addEventListener("click", function (e) {
  var sendBtn = e.target.closest ? e.target.closest("[data-comment-post]") : null;
  if (!sendBtn) return;
  var postId = sendBtn.getAttribute("data-comment-post");
  saveComment(postId);
});

// 댓글 입력창에서 Enter 키로 전송
document.addEventListener("keydown", function (e) {
  if (e.key !== "Enter") return;
  var input = e.target;
  if (!input.classList.contains("fp-comment-input")) return;
  var postId = input.id.replace("comment-input-", "");
  if (postId) saveComment(postId);
});
