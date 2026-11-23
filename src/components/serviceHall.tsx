import { assetUrl } from "../helpers/assets";
import { BRANDING } from "../helpers/env";
import { responsivePortraitSources } from "../helpers/responsivePortrait";

/**
 * Unofficial fan characters from JAdpp/dsh-whale-galgame (CC BY-NC-SA). See the character
 * attribution supplied with the local assets. The room, sleeve/hand rigs, paper props and CSS poses
 * are original scene derivatives. These gestures are procedural, not poses claimed from the source.
 * All business state is owned by the caller through #service-hall[data-stage].
 */

function HallPlant({ side }: { side: "left" | "right" }) {
  return (
    <div
      class={side === "left" ? "hall-plant hall-plant-left" : "hall-plant hall-plant-right"}
      aria-hidden="true"
    >
      <i class="hall-leaf hall-leaf-one" />
      <i class="hall-leaf hall-leaf-two" />
      <i class="hall-leaf hall-leaf-three" />
      <i class="hall-leaf hall-leaf-four" />
      <i class="hall-plant-stem" />
      <i class="hall-plant-pot" />
    </div>
  );
}

function HallWhale() {
  return (
    <svg class="hall-whale-mark" viewBox="0 0 48 32" fill="none" aria-hidden="true">
      <path
        d="M37 10c3-5 7-5 9-4-1 6-5 9-10 9-3 10-12 16-24 11C3 22 0 13 4 7c2 9 12 11 17 5 5-5 11-5 16-2Z"
        fill="currentColor"
      />
      <path
        d="M18 7c-4-4-1-7 2-6m3 5c1-5 5-5 6-3"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <circle cx="29" cy="16" r="1.6" fill="white" />
    </svg>
  );
}

function HallHands() {
  return (
    <div class="hall-hand-rig" aria-hidden="true">
      <svg class="hall-rig-arm hall-rig-left" viewBox="0 0 160 112" fill="none">
        <path class="hall-sleeve" d="M12 14c16-10 31-2 35 14l19 30-25 21-24-35C8 30 6 20 12 14Z" />
        <path class="hall-cuff" d="m41 57 23-12 11 18-24 17Z" />
        <path
          class="hall-skin"
          d="m65 64 27 12 24-9c7-3 12 3 7 6l-11 7 22-3c7-1 10 5 3 8l-22 7c-13 5-20 3-29-1L60 80Z"
        />
        <path class="hall-hand-line" d="m107 83 17-4m-15 9 17-4" />
      </svg>
      <svg class="hall-rig-arm hall-rig-right" viewBox="0 0 160 112" fill="none">
        <path class="hall-sleeve" d="M12 14c16-10 31-2 35 14l19 30-25 21-24-35C8 30 6 20 12 14Z" />
        <path class="hall-cuff" d="m41 57 23-12 11 18-24 17Z" />
        <path
          class="hall-skin"
          d="m65 64 27 12 24-9c7-3 12 3 7 6l-11 7 22-3c7-1 10 5 3 8l-22 7c-13 5-20 3-29-1L60 80Z"
        />
        <path class="hall-hand-line" d="m107 83 17-4m-15 9 17-4" />
      </svg>
    </div>
  );
}

// These small SVG eyelid and tail rigs are local CSS/SVG adaptations, not extra source poses.
function HallWhaleDetails() {
  return (
    <>
      <svg class="hall-motion-tail" viewBox="0 0 82 76" aria-hidden="true">
        <path
          d="M4 74C27 58 40 44 44 29C31 25 23 13 26 3C33 11 43 10 52 21C59 10 67 13 77 4C78 19 70 32 58 35C54 52 41 69 19 76Z"
          fill="#526797"
          stroke="#35486e"
          stroke-width="1.5"
        />
        <path
          d="M51 31C52 44 39 64 23 73M30 8C31 14 38 19 46 23"
          fill="none"
          stroke="#879bc2"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <svg
        class="hall-motion-lids"
        viewBox="0 0 1122 2019"
        preserveAspectRatio="xMidYMax meet"
        aria-hidden="true"
      >
        <g class="hall-motion-lids-default">
          <path d="M451 285Q458 255 484 255Q508 257 510 281Q488 303 465 301Z M553 248Q559 223 586 223Q608 225 610 248Q589 269 565 267Z" />
          <path class="hall-motion-lash" d="M453 284Q477 268 506 276M554 248Q579 236 605 243" />
        </g>
        <g class="hall-motion-lids-ready">
          <path d="M518 307Q521 280 547 281Q572 284 573 306Q549 329 531 326Z M618 280Q623 252 651 253Q675 256 678 279Q650 303 631 299Z" />
          <path class="hall-motion-lash" d="M520 306Q545 294 571 303M620 279Q647 266 673 276" />
        </g>
        <g class="hall-motion-lids-error">
          <path d="M476 270Q483 247 505 248Q529 249 532 267Q508 285 486 285Z M583 244Q590 224 613 225Q637 226 642 242Q619 261 597 259Z" />
          <path class="hall-motion-lash" d="M478 269Q504 256 528 263M585 243Q613 232 638 239" />
        </g>
      </svg>
    </>
  );
}

// Characters face the screens; customers see the rear casing, stand and ports.
function HallMonitor({ type }: { type: "claude" | "deepseek" | "gpt" }) {
  const labels = { claude: "CLAUDE / DEV", deepseek: "WHALE / SERVICE 02", gpt: "GPT / HELLO" };
  const classes = {
    claude: "hall-monitor hall-monitor-claude",
    deepseek: "hall-monitor hall-monitor-deepseek",
    gpt: "hall-monitor hall-monitor-gpt",
  };
  return (
    <div class={classes[type]} aria-hidden="true" data-facing="character">
      <div class="hall-monitor-rear">
        <span class="hall-rear-emblem">
          {type === "deepseek" ? <HallWhale /> : type === "gpt" ? "✳" : "✦"}
        </span>
        <i class="hall-rear-vents" />
        <span class="hall-rear-ports">
          <i />
          <i />
          <i />
        </span>
        <span class="hall-rear-power" />
        <span class="hall-monitor-brand" safe>
          {labels[type]}
        </span>
      </div>
      <span class="hall-monitor-cable" />
      {type === "deepseek" && (
        <span id="hall-task-label" class="cx-sr-only">
          等待办理
        </span>
      )}
    </div>
  );
}

export function ServiceHall({ webroot = "" }: { webroot?: string; jobId?: string }) {
  const character = (name: string) => assetUrl(webroot, `characters/${name}.webp`);
  const portraitAttrs = (name: string, sizes: string) => {
    const srcset = responsivePortraitSources(webroot, `${name}.webp`);
    return srcset ? { srcset, sizes } : {};
  };
  return (
    <section
      id="service-hall"
      class="service-hall"
      data-stage="welcome"
      role="region"
      aria-label={BRANDING}
    >
      <div class="hall-room">
        <div class="hall-ceiling-light hall-ceiling-light-left" aria-hidden="true" />
        <div class="hall-ceiling-light hall-ceiling-light-right" aria-hidden="true" />
        <div class="hall-window hall-window-left" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div class="hall-window hall-window-center" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div class="hall-window hall-window-right" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div class="hall-wall-note" aria-hidden="true">
          <span>温馨提醒</span>文件各有归处
          <br />
          慢慢来，交给我。
        </div>
        <HallPlant side="left" />
        <HallPlant side="right" />

        <div class="hall-stations">
          <div class="hall-station hall-station-claude">
            <div class="hall-station-stage">
              <div class="hall-bay-label">
                <b>01</b>
                <span>
                  代码专席<small>CLAUDE</small>
                </span>
                <i />
              </div>
              <div class="hall-side-bubble hall-claude-bubble">
                怎么还有代码要写
                <span class="hall-motion-mutter" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span aria-hidden="true">💢</span>
              </div>
              <div class="hall-character hall-character-claude">
                <div class="hall-motion-body hall-motion-claude">
                  <img
                    class="hall-character-image"
                    src={character("claude")}
                    {...portraitAttrs("claude", "(max-width: 700px) 280px, 340px")}
                    alt="Claude 二次元同人角色"
                    width="260"
                    height="330"
                    draggable="false"
                  />
                  <span class="hall-frustration" aria-hidden="true">
                    ╬
                  </span>
                  <span class="hall-sweat" aria-hidden="true" />
                  <svg
                    class="hall-motion-claude-brows"
                    viewBox="0 0 1013 1868"
                    fill="none"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <g class="hall-motion-claude-frown">
                      <path d="M438 150Q458 147 478 160M511 151Q533 132 554 135" />
                    </g>
                    <g class="hall-motion-claude-eye-rest">
                      <ellipse cx="460" cy="180" rx="24" ry="12" transform="rotate(-14 460 180)" />
                      <ellipse cx="540" cy="157" rx="23" ry="12" transform="rotate(-14 540 157)" />
                      <path d="M440 181Q459 190 479 173M521 158Q541 165 559 149" />
                    </g>
                  </svg>
                  <span class="hall-motion-claude-sigh" aria-hidden="true">
                    <span class="hall-motion-sigh-one">唉……</span>
                    <span class="hall-motion-sigh-two">又改？！</span>
                  </span>
                  <img
                    class="hall-motion-cutout hall-motion-claude-tassel"
                    src={character("claude")}
                    {...portraitAttrs("claude", "(max-width: 700px) 280px, 340px")}
                    alt=""
                    aria-hidden="true"
                    draggable="false"
                  />
                </div>
              </div>
              <div class="hall-side-typing" aria-hidden="true">
                <i />
                <i />
              </div>
              <HallMonitor type="claude" />
              <div class="hall-side-keyboard" aria-hidden="true" />
              <div class="hall-mug hall-mug-claude" aria-hidden="true">
                <i class="hall-motion-steam" />
                <i class="hall-motion-steam" />
                <span>;</span>
              </div>
              <div class="hall-station-front">
                <b>Claude</b>
                <span>代码加班中</span>
                <i class="hall-front-light" />
              </div>
            </div>
          </div>

          <div class="hall-station hall-station-deepseek">
            <div class="hall-bay-label">
              <b>02</b>
              <span>
                文件转换专席<small>DEEPSEEK</small>
              </span>
              <i />
            </div>
            <div class="hall-dialogue-wrap">
              <span class="hall-dialogue-avatar" aria-hidden="true">
                <HallWhale />
              </span>
              <p id="hall-dialogue" class="hall-dialogue" role="status" aria-live="polite">
                欢迎光临！今天想把文件转换成什么格式呢？
              </p>
              <span class="hall-dialogue-spark" aria-hidden="true">
                ✦
              </span>
            </div>
            <div class="hall-chair" aria-hidden="true" />
            <div class="hall-character hall-character-deepseek">
              <div class="hall-motion-body hall-motion-deepseek">
                <img
                  class="hall-character-image hall-face-default"
                  src={character("deepseek-standing")}
                  {...portraitAttrs("deepseek-standing", "(max-width: 700px) 280px, 340px")}
                  alt="DeepSeek 鲸鱼娘二次元同人角色"
                  width="340"
                  height="440"
                  draggable="false"
                />
                <img
                  class="hall-character-image hall-face-cheerful"
                  src={character("whale-cheerful")}
                  {...portraitAttrs("whale-cheerful", "(max-width: 700px) 280px, 340px")}
                  alt=""
                  aria-hidden="true"
                  width="340"
                  height="440"
                  draggable="false"
                />
                <img
                  class="hall-character-image hall-face-serious"
                  src={character("whale-serious")}
                  {...portraitAttrs("whale-serious", "(max-width: 700px) 280px, 340px")}
                  alt=""
                  aria-hidden="true"
                  width="340"
                  height="440"
                  draggable="false"
                />
                <img
                  class="hall-character-image hall-face-starry"
                  src={character("whale-starry")}
                  {...portraitAttrs("whale-starry", "(max-width: 700px) 280px, 340px")}
                  alt=""
                  aria-hidden="true"
                  width="340"
                  height="440"
                  draggable="false"
                />
                <img
                  class="hall-character-image hall-face-exasperated"
                  src={character("whale-exasperated")}
                  {...portraitAttrs("whale-exasperated", "(max-width: 700px) 280px, 340px")}
                  alt=""
                  aria-hidden="true"
                  width="340"
                  height="440"
                  draggable="false"
                />
                <img
                  class="hall-native-hand"
                  src={character("deepseek-standing")}
                  {...portraitAttrs("deepseek-standing", "(max-width: 700px) 280px, 340px")}
                  alt=""
                  aria-hidden="true"
                  width="1122"
                  height="2019"
                  draggable="false"
                />
                <HallWhaleDetails />
                <HallHands />
                <span class="hall-idle-note" aria-hidden="true">
                  ♪
                </span>
                <span class="hall-work-spark hall-work-spark-one" aria-hidden="true">
                  ✧
                </span>
                <span class="hall-work-spark hall-work-spark-two" aria-hidden="true">
                  ✦
                </span>
              </div>
            </div>
            <div class="hall-motion-reaction" aria-hidden="true">
              <span class="hall-motion-question">?</span>
              <span class="hall-motion-spark">✦</span>
              <span class="hall-motion-concern">!</span>
              <span class="hall-motion-break">♪</span>
            </div>
            <div class="hall-native-action hall-native-work" aria-hidden="true">
              <img
                class="hall-work-frame hall-work-frame-one"
                src={character("crop-deepseek-work-0")}
                alt=""
                width="384"
                height="512"
                draggable="false"
              />
              <img
                class="hall-work-frame hall-work-frame-two"
                src={character("crop-deepseek-work-1")}
                alt=""
                width="384"
                height="512"
                draggable="false"
              />
              <img
                class="hall-work-frame hall-work-frame-three"
                src={character("crop-deepseek-work-2")}
                alt=""
                width="384"
                height="512"
                draggable="false"
              />
            </div>
            <div class="hall-native-action hall-native-leisure" aria-hidden="true">
              <img
                class="hall-meal-frame hall-meal-frame-one"
                src={character("crop-deepseek-meal-0")}
                alt=""
                width="384"
                height="512"
                draggable="false"
              />
              <img
                class="hall-meal-frame hall-meal-frame-two"
                src={character("crop-deepseek-meal-1")}
                alt=""
                width="384"
                height="512"
                draggable="false"
              />
              <span class="hall-break-label">忙完啦，吃一口～ ♪</span>
            </div>
            <button
              id="hall-receive"
              class="hall-receive"
              type="button"
              aria-label="点击DeepSeek的手上传文件"
              disabled
            >
              <span class="hall-hand-target hall-hand-target-left" aria-hidden="true">
                <i />
                <i />＋
              </span>
              <span class="hall-hand-target hall-hand-target-right" aria-hidden="true">
                <i />
                <i />＋
              </span>
              <span class="hall-receive-label">
                点我的手，交文件 <span aria-hidden="true">↑</span>
              </span>
            </button>
            <div class="hall-incoming-paper" aria-hidden="true">
              <i />
              <i />
              <i />
              <span>FILE</span>
            </div>
            <HallMonitor type="deepseek" />
            <div class="hall-keyboard" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div class="hall-typing-hands" aria-hidden="true">
              <i />
              <i />
            </div>
            <div class="hall-mug hall-mug-deepseek" aria-hidden="true">
              <i />
              <HallWhale />
            </div>
            <div id="hall-stack" class="hall-stack" hidden>
              <button
                id="collect-files"
                class="hall-collect"
                type="button"
                aria-label="领取并下载转换后的文件"
              >
                <span class="hall-paper-sheet hall-paper-back" aria-hidden="true" />
                <span class="hall-paper-sheet hall-paper-middle" aria-hidden="true" />
                <span class="hall-paper-sheet hall-paper-front">
                  <span class="hall-paper-seal" aria-hidden="true">
                    ✓
                  </span>
                  <strong id="hall-stack-count">0 份</strong>
                  <span id="hall-top-file">文件已办好</span>
                  <span class="hall-paper-lines" aria-hidden="true" />
                </span>
                <span class="hall-collect-label">
                  点击取件 <span aria-hidden="true">↓</span>
                </span>
              </button>
            </div>
            <button id="hall-start-new" class="hall-start-new" type="button" hidden>
              再办一单 <span aria-hidden="true">↗</span>
            </button>
            <div class="hall-station-front">
              <b>DeepSeek</b>
              <span>文件办理中</span>
              <i class="hall-front-light" />
            </div>
          </div>

          <div class="hall-station hall-station-gpt">
            <div class="hall-station-stage">
              <div class="hall-bay-label">
                <b>03</b>
                <span>
                  咨询专席<small>GPT</small>
                </span>
                <i />
              </div>
              <div class="hall-side-bubble hall-gpt-bubble">
                文件转换请找鲸鱼娘<span aria-hidden="true">↙</span>
              </div>
              <div class="hall-character hall-character-gpt">
                <div class="hall-motion-body hall-motion-gpt">
                  <img
                    class="hall-character-image"
                    src={character("gpt")}
                    {...portraitAttrs("gpt", "(max-width: 700px) 280px, 340px")}
                    alt="GPT 二次元同人角色"
                    width="260"
                    height="330"
                    draggable="false"
                  />
                  <img
                    class="hall-motion-cutout hall-motion-gpt-tassel"
                    src={character("gpt")}
                    {...portraitAttrs("gpt", "(max-width: 700px) 280px, 340px")}
                    alt=""
                    aria-hidden="true"
                    draggable="false"
                  />
                  <img
                    class="hall-motion-cutout hall-motion-gpt-cloud"
                    src={character("gpt")}
                    {...portraitAttrs("gpt", "(max-width: 700px) 280px, 340px")}
                    alt=""
                    aria-hidden="true"
                    draggable="false"
                  />
                  <span class="hall-motion-star hall-motion-star-first" aria-hidden="true">
                    ✦
                  </span>
                  <span class="hall-motion-star hall-motion-star-second" aria-hidden="true">
                    ✧
                  </span>
                </div>
              </div>
              <HallMonitor type="gpt" />
              <div class="hall-side-keyboard" aria-hidden="true" />
              <div class="hall-mug hall-mug-gpt" aria-hidden="true">
                <i />
                <span>☺</span>
              </div>
              <div class="hall-station-front">
                <b>GPT</b>
                <span>礼貌值班中</span>
                <i class="hall-front-light" />
              </div>
            </div>
          </div>
        </div>
        <div class="hall-counter" aria-hidden="true">
          <div class="hall-counter-top" />
          <div class="hall-counter-edge" />
          <div class="hall-counter-face" />
        </div>
        <div class="hall-divider hall-divider-left" aria-hidden="true">
          <i />
          <span />
        </div>
        <div class="hall-divider hall-divider-right" aria-hidden="true">
          <i />
          <span />
        </div>
        <div class="hall-floor" aria-hidden="true" />
        <div class="hall-floor-caption">
          <span class="hall-floor-dot" /> 先选格式，再把文件交给我 <span aria-hidden="true">✦</span>
        </div>
      </div>
    </section>
  );
}
