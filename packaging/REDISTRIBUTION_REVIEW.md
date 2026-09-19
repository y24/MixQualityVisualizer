> 過去のエンジン再配布案の確認記録です。現行ビルドはPython・解析ライブラリ非同梱に変更し、利用者のpip/uvが上流から直接取得します。この記録の未完了項目を現行アプリの公開条件とはしません。Electronなど実際に同梱する部品の条件は引き続き適用されます。

# Mix Atlas 配布条件の確認記録

確認日: 2026-09-19。対象: Windowsビルド 0.1.0-15、CPython 3.13.3、
PyTorch/torchaudio 2.8.0+cu128、cuDNN 9.10.2、libsndfile 1.2.2。

## 結論と現在の状態

再配布を認めるライセンスが中心ですが、無条件ではありません。
現在の成果物は動作確認済みの配布候補であり、再配布条件の確認完了品ではありません。
ライセンスのコピーを含めるだけで全条件を満たすとは判断していません。
初回ダウンロード用にGitHub Releasesへアップロードする行為も再配布です。

## 実物から確認した事項

- エンジンZIP内の49個のパッケージメタデータ（setuptools内の同梱依存を含む）を収集。
  `dependency-licenses.json` は名称・バージョン・宣言されたライセンスファイルの所在を記録します。
  この一覧は法的な適合証明や、全ネイティブ依存の完全なSBOMではありません。
- PyTorchはBSD-3-Clause。DemucsはMIT。多くのPython依存はMIT/BSD/Apache系。
  各パッケージのLICENSE/NOTICEを維持します。
- `lameenc 1.8.4` はLGPL-3.0-or-later。Python拡張バイナリとLAMEの組合せを含みます。
- `soundfile 0.14.0` 自体はBSDですが、同梱の `libsndfile_x64.dll` はLGPL系です。
  `_soundfile_data/COPYING` はLGPL-2.1本文です。
- setuptoolsに含まれるautocommandのメタデータはLGPLv3です。ソース形式での同梱と
  バイナリライブラリのソース提供義務を分けて確認する必要があります。
- PyTorchのLICENSEは第三者部品の多数のライセンスを集約しています。
  その中にGPL/LGPLの文章があることだけでは、アプリ全体のライセンスを断定できません。
- CUDA/cuDNNのDLLはPyTorchのBSDライセンスだけでは扱えません。
  NVIDIAの再配布対象一覧と各SDKの条件が適用されます。
- ElectronのLICENSE/ LICENSES.chromium.html、PythonのLICENSE.txtを保持しています。
- モデル重みは配布ZIPに含めず、初回分離時に従来の公式取得経路で取得します。
  コードのMIT表記だけで、個々のモデル重みの条件まで断定していません。

## 修正した梱包上の問題

ヘッダーを除外する処理が、NumPyのライセンス保存用パスに含まれる `include` まで
除外していました。LICENSE/LICENCE/COPYING/NOTICE/AUTHORSは除外しないよう修正。
今後の軽量ビルドでは、メタデータが宣言するライセンスファイルに不足があると失敗します。

## 公開前に残る具体的な対応

1. lameenc/LAMEとlibsndfile、およびバイナリへ組み込まれた関連ライブラリについて、
   配布バイナリに対応するソース・ビルド手順を揃え、適切なソース提供方法を実装する。
   単に上流リポジトリのトップページを紹介するだけで完了とはしない。
2. LGPL対象ライブラリの利用表示、必要なGPL/LGPL本文、差し替え・再リンクの手順を揃える。
   対象ライブラリの改変とそのデバッグのためのリバースエンジニアリングを、
   アプリの利用条件で一律に禁止しない。
3. 含めるNVIDIA DLLごとに対応するSDK/EULAと再配布対象を確認し、必要な文書と
   それらに整合する配布条件を用意する。CUDA 12.8.1の一覧、cuDNN 9.10.2の条件を参照済み。
   アプリ専用ディレクトリでの利用、SDK単体の再配布との区別にも留意する。
4. Electron/Chromium、数値計算ライブラリのネイティブ依存と例外条項を確認し、
   メタデータ一覧だけでは検出できないソース・表示義務の不足を解消する。

これらは配布物の準備事項であり、ユーザーの「承認」だけで解消するものではありません。
公開用スクリプトは現状では下書きのアップロードまでとし、自動公開しません。

## 一次資料

- [PyTorch 2.8.0 LICENSE](https://github.com/pytorch/pytorch/blob/v2.8.0/LICENSE)
- [Demucs LICENSE](https://github.com/facebookresearch/demucs/blob/main/LICENSE)
- [lameenc 1.8.4 LICENSE](https://github.com/chrisstaite/lameenc/blob/v1.8.4/LICENSE)
- [libsndfile 1.2.2 COPYING](https://github.com/libsndfile/libsndfile/blob/1.2.2/COPYING)
- [GNU LGPL v3 第4条](https://www.gnu.org/licenses/lgpl-3.0.html)
- [GNU LGPL v2.1](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html)
- [CUDA 12.8.1 EULAと再配布対象一覧](https://docs.nvidia.com/cuda/archive/12.8.1/eula/index.html)
- [cuDNN 9.10.2 EULA](https://docs.nvidia.com/deeplearning/cudnn/backend/v9.10.2/reference/eula.html)
